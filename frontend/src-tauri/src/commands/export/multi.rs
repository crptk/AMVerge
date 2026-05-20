use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;

use super::encode::{append_audio_encode_args, ffmpeg_reencode_args, select_gpu_encoder_for_codec};
use super::probe::{
    clip_video_start_ms, ffprobe_duration_ms, is_ae_copy_safe,
};
use super::progress::{
    emit_export_progress, export_canceled_error, is_canceled_error_text, is_export_cancel_requested,
};
use super::runner::run_ffmpeg_with_progress;
use super::types::{ClipExportJob, ExportOptionsPayload, ExportRuntime};

fn format_seek_seconds(ms: u64) -> String {
    let seconds = ms as f64 / 1000.0;
    let value = format!("{seconds:.6}");
    value
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn build_copy_args(
    input: &str,
    output: &str,
    options: Option<&ExportOptionsPayload>,
    input_seek_ms: Option<u64>,
    bsf: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["-y".into()];
    let audio_mode = options.map(|o| o.audio_mode.as_str()).unwrap_or("copy");

    if let Some(ms) = input_seek_ms.filter(|ms| *ms > 0) {
        args.extend(["-ss".into(), format_seek_seconds(ms)]);
    }

    args.extend([
        "-i".into(),
        input.to_string(),
        "-map".into(),
        "0:v:0".into(),
    ]);
    if audio_mode != "none" {
        args.extend(["-map".into(), "0:a?".into()]);
    }

    args.extend(["-c:v".into(), "copy".into()]);
    if audio_mode == "none" {
        args.push("-an".into());
    } else if audio_mode == "copy" {
        args.extend(["-c:a".into(), "copy".into()]);
    } else {
        append_audio_encode_args(&mut args, options);
    }

    if let Some(name) = bsf {
        args.extend(["-bsf:v".into(), name.to_string()]);
    }
    args.extend([
        "-movflags".into(),
        "+faststart".into(),
        output.to_string(),
    ]);

    args
}

fn copy_bsf_for_job(runtime: &ExportRuntime, output: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(output)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    super::compat::stream_copy_bsf_for(runtime.source_video_codec.as_deref(), &ext)
}

fn uses_gpu_encoding(options: Option<&ExportOptionsPayload>) -> bool {
    matches!(
        options.map(|o| o.hardware_mode.as_str()),
        Some("auto") | Some("gpu")
    )
}

fn selected_gpu_encoder<'a>(
    runtime: &'a ExportRuntime,
    options: Option<&'a ExportOptionsPayload>,
) -> Option<&'a str> {
    let codec = options.map(|o| o.codec.as_str()).unwrap_or("h264_high");
    select_gpu_encoder_for_codec(codec, &runtime.gpu_capabilities)
}

fn is_gpu_session_open_error(error_text: &str) -> bool {
    let text = error_text.to_ascii_lowercase();
    let mentions_hw_encoder = text.contains("nvenc")
        || text.contains("openencodesessionex")
        || text.contains("_amf")
        || text.contains("amf")
        || text.contains("_qsv")
        || text.contains("qsv")
        || text.contains("videotoolbox")
        || text.contains("vaapi");

    if !mentions_hw_encoder {
        return false;
    }

    text.contains("openencodesessionex failed")
        || text.contains("no capable devices found")
        || text.contains("incompatible client key")
        || text.contains("unsupported device")
        || text.contains("error while opening encoder")
        || text.contains("failed to initialise")
        || text.contains("failed to initialize")
        || text.contains("device failed")
        || text.contains("encoder not found")
        || text.contains("function not implemented")
        || text.contains("invalid argument")
}

fn should_retry_reencode_on_cpu(error_text: &str, options: Option<&ExportOptionsPayload>) -> bool {
    uses_gpu_encoding(options) && is_gpu_session_open_error(error_text)
}

fn to_cpu_options(options: Option<&ExportOptionsPayload>) -> Option<ExportOptionsPayload> {
    options.cloned().map(|mut payload| {
        payload.hardware_mode = "cpu".to_string();
        payload
    })
}

async fn run_one_job(
    runtime: &ExportRuntime,
    job: ClipExportJob,
    done_before: u64,
    grand_total: Option<u64>,
    emit_per_clip_progress: bool,
) -> Result<(usize, String, u64), String> {
    let msg = format!("Exporting clip {}/{}", job.index + 1, job.total);
    let input_base = file_name_only(&job.input);
    let output_base = file_name_only(&job.output);
    let gpu_encoder = selected_gpu_encoder(runtime, runtime.export_options.as_ref());

    let (mode_msg, args) = if job.copy_ok {
        (
            format!("{msg} (copy)"),
            build_copy_args(
                &job.input,
                &job.output,
                runtime.export_options.as_ref(),
                job.input_seek_ms,
                copy_bsf_for_job(runtime, &job.output),
            ),
        )
    } else {
        (
            format!("{msg} (re-encode)"),
            ffmpeg_reencode_args(
                &job.input,
                &job.output,
                runtime.export_options.as_ref(),
                job.input_seek_ms,
                gpu_encoder,
            ),
        )
    };

    console_log(
        "EXPORT|clip",
        &format!(
            "{}/{} input={} output={} mode={}",
            job.index + 1,
            job.total,
            input_base,
            output_base,
            if job.copy_ok { "copy" } else { "re-encode" }
        ),
    );

    let app_for_ffmpeg = runtime.app.clone();
    let ffmpeg_clone = runtime.ffmpeg.clone();
    let run_msg = mode_msg.clone();
    let run_args = args;
    let start_time = runtime.export_start_time;
    let abort_requested_for_run = runtime.abort_requested.clone();
    let active_pids_for_run = runtime.active_pids.clone();
    let clip_total = job.clip_total;

    let first_result = tokio::task::spawn_blocking(move || {
        run_ffmpeg_with_progress(
            app_for_ffmpeg,
            ffmpeg_clone,
            run_args,
            clip_total,
            done_before,
            grand_total,
            &run_msg,
            start_time,
            abort_requested_for_run,
            active_pids_for_run,
            emit_per_clip_progress,
        )
    })
    .await
    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

    if let Err(err) = first_result {
        if is_export_cancel_requested(&runtime.abort_requested) {
            return Err(export_canceled_error());
        }

        if job.copy_ok {
            console_log(
                "EXPORT|retry",
                &format!(
                    "clip {}/{} stream copy failed; retry re-encode (input={} output={})",
                    job.index + 1,
                    job.total,
                    input_base,
                    output_base
                ),
            );

            let app_for_ffmpeg = runtime.app.clone();
            let ffmpeg_clone = runtime.ffmpeg.clone();
            let run_msg = format!("{msg} (re-encode)");
            let run_args = ffmpeg_reencode_args(
                &job.input,
                &job.output,
                runtime.export_options.as_ref(),
                job.input_seek_ms,
                gpu_encoder,
            );
            let start_time = runtime.export_start_time;
            let abort_requested_for_run = runtime.abort_requested.clone();
            let active_pids_for_run = runtime.active_pids.clone();

            let retry_result = tokio::task::spawn_blocking(move || {
                run_ffmpeg_with_progress(
                    app_for_ffmpeg,
                    ffmpeg_clone,
                    run_args,
                    clip_total,
                    done_before,
                    grand_total,
                    &run_msg,
                    start_time,
                    abort_requested_for_run,
                    active_pids_for_run,
                    emit_per_clip_progress,
                )
            })
            .await
            .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

            if let Err(retry_err) = retry_result {
                if is_canceled_error_text(&retry_err) {
                    return Err(retry_err);
                }

                if should_retry_reencode_on_cpu(&retry_err, runtime.export_options.as_ref()) {
                    console_log(
                        "EXPORT|retry",
                        &format!(
                            "clip {}/{} gpu encoder init failed; retry re-encode on cpu (input={} output={})",
                            job.index + 1,
                            job.total,
                            input_base,
                            output_base
                        ),
                    );

                    let app_for_ffmpeg = runtime.app.clone();
                    let ffmpeg_clone = runtime.ffmpeg.clone();
                    let cpu_options = to_cpu_options(runtime.export_options.as_ref());
                    let cpu_args = ffmpeg_reencode_args(
                        &job.input,
                        &job.output,
                        cpu_options.as_ref(),
                        job.input_seek_ms,
                        None,
                    );
                    let start_time = runtime.export_start_time;
                    let abort_requested_for_run = runtime.abort_requested.clone();
                    let active_pids_for_run = runtime.active_pids.clone();

                    let cpu_retry_result = tokio::task::spawn_blocking(move || {
                        run_ffmpeg_with_progress(
                            app_for_ffmpeg,
                            ffmpeg_clone,
                            cpu_args,
                            clip_total,
                            done_before,
                            grand_total,
                            &format!("{msg} (re-encode/cpu fallback)"),
                            start_time,
                            abort_requested_for_run,
                            active_pids_for_run,
                            emit_per_clip_progress,
                        )
                    })
                    .await
                    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

                    if let Err(cpu_err) = cpu_retry_result {
                        if is_canceled_error_text(&cpu_err) {
                            return Err(cpu_err);
                        }
                        return Err(format!(
                            "FFmpeg export failed.\n(copy)\n{err}\n\n(re-encode)\n{retry_err}\n\n(cpu fallback)\n{cpu_err}"
                        ));
                    }
                } else {
                    return Err(format!(
                        "FFmpeg export failed.\n(copy)\n{err}\n\n(re-encode)\n{retry_err}"
                    ));
                }
            }
        } else {
            if is_canceled_error_text(&err) {
                return Err(err);
            }

            if should_retry_reencode_on_cpu(&err, runtime.export_options.as_ref()) {
                console_log(
                    "EXPORT|retry",
                    &format!(
                        "clip {}/{} gpu encoder init failed; retry re-encode on cpu (input={} output={})",
                        job.index + 1,
                        job.total,
                        input_base,
                        output_base
                    ),
                );

                let app_for_ffmpeg = runtime.app.clone();
                let ffmpeg_clone = runtime.ffmpeg.clone();
                let cpu_options = to_cpu_options(runtime.export_options.as_ref());
                let cpu_args = ffmpeg_reencode_args(
                    &job.input,
                    &job.output,
                    cpu_options.as_ref(),
                    job.input_seek_ms,
                    None,
                );
                let start_time = runtime.export_start_time;
                let abort_requested_for_run = runtime.abort_requested.clone();
                let active_pids_for_run = runtime.active_pids.clone();

                let cpu_retry_result = tokio::task::spawn_blocking(move || {
                    run_ffmpeg_with_progress(
                        app_for_ffmpeg,
                        ffmpeg_clone,
                        cpu_args,
                        clip_total,
                        done_before,
                        grand_total,
                        &format!("{msg} (re-encode/cpu fallback)"),
                        start_time,
                        abort_requested_for_run,
                        active_pids_for_run,
                        emit_per_clip_progress,
                    )
                })
                .await
                .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

                if let Err(cpu_err) = cpu_retry_result {
                    if is_canceled_error_text(&cpu_err) {
                        return Err(cpu_err);
                    }
                    return Err(format!(
                        "FFmpeg export failed.\n(gpu)\n{err}\n\n(cpu fallback)\n{cpu_err}"
                    ));
                }
            } else {
                return Err(format!("FFmpeg export failed: {err}"));
            }
        }
    }

    Ok((job.index, job.output, clip_total.unwrap_or(0)))
}

fn build_clip_jobs(
    clips: &[String],
    destination_dir: &Path,
    user_stem: &str,
    ext: &str,
    per_copy_safe: &[bool],
    per_input_seek_ms: &[Option<u64>],
    per_ms: &[Option<u64>],
    abort_requested: &Arc<AtomicBool>,
) -> Result<Vec<ClipExportJob>, String> {
    let mut jobs = Vec::with_capacity(clips.len());
    let mut used_stems: HashSet<String> = HashSet::with_capacity(clips.len());

    for (index, clip) in clips.iter().enumerate() {
        if is_export_cancel_requested(abort_requested) {
            return Err(export_canceled_error());
        }

        let clip_path = Path::new(clip);
        let clip_stem = clip_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("");
        let clip_code = clip_stem
            .rsplit('_')
            .next()
            .filter(|part| !part.is_empty())
            .unwrap_or("0000");

        let code = if clip_code.chars().all(|ch| ch.is_ascii_digit()) {
            clip_code.to_string()
        } else {
            format!("{:04}", index)
        };

        let base_file_stem = if user_stem.contains("####") {
            user_stem.replace("####", &code)
        } else {
            format!("{}_{}", user_stem, code)
        };

        let mut file_stem = base_file_stem.clone();
        let mut duplicate_index = 1usize;
        let mut deduped_name = false;
        while !used_stems.insert(file_stem.clone()) {
            deduped_name = true;
            file_stem = format!("{base_file_stem}_{duplicate_index:02}");
            duplicate_index = duplicate_index.saturating_add(1);
        }
        if deduped_name {
            console_log(
                "EXPORT|naming",
                &format!("duplicate output stem detected; renamed to {}", file_stem),
            );
        }

        let destination = destination_dir.join(format!("{}.{}", file_stem, ext));
        let output = destination
            .to_str()
            .ok_or("Invalid destination path")?
            .to_string();

        jobs.push(ClipExportJob {
            index,
            total: clips.len(),
            input: clip.clone(),
            output,
            copy_ok: per_copy_safe.get(index).copied().unwrap_or(false),
            input_seek_ms: per_input_seek_ms.get(index).copied().flatten(),
            clip_total: per_ms.get(index).copied().flatten(),
        });
    }

    Ok(jobs)
}

pub(super) async fn run_multi_export(
    runtime: &ExportRuntime,
    clips: &[String],
    save_path: &Path,
) -> Result<Vec<String>, String> {
    let destination_dir = save_path.parent().ok_or("Invalid save path")?;
    let user_stem = save_path
        .file_stem()
        .ok_or("Invalid filename")?
        .to_string_lossy()
        .to_string();

    let ext = save_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_string();

    emit_export_progress(
        &runtime.app,
        5,
        "Probing clip info...",
        runtime.export_start_time,
    );

    let mut per_ms: Vec<Option<u64>> = Vec::with_capacity(clips.len());
    let mut total_ms: Option<u64> = Some(0);
    let mut per_copy_safe: Vec<bool> = Vec::with_capacity(clips.len());
    let mut per_input_seek_ms: Vec<Option<u64>> = Vec::with_capacity(clips.len());

    for clip in clips {
        if is_export_cancel_requested(&runtime.abort_requested) {
            return Err(export_canceled_error());
        }

        let duration = ffprobe_duration_ms(runtime.ffprobe.clone(), clip.clone())
            .await
            .ok()
            .flatten();
        per_ms.push(duration);

        if let (Some(total), Some(ms)) = (total_ms, duration) {
            total_ms = Some(total.saturating_add(ms));
        } else {
            total_ms = None;
        }

        let video_start_ms = clip_video_start_ms(runtime.ffprobe.clone(), clip.clone())
            .await
            .ok()
            .flatten();
        let leading_gap_seek_ms = video_start_ms.filter(|ms| *ms >= 20);

        let copy_safe = if runtime.remux_workflow {
            // Copy-first for remux workflow. Let ffmpeg be the source of truth and
            // fall back to re-encode only on actual stream-copy failure.
            if let Some(ms) = leading_gap_seek_ms {
                console_log(
                    "EXPORT|remux",
                    &format!(
                        "normalizing leading gap via stream copy seek={}ms (input={})",
                        ms,
                        file_name_only(clip)
                    ),
                );
            }
            true
        } else if runtime.force_encode_workflow {
            false
        } else {
            is_ae_copy_safe(runtime.ffprobe.clone(), clip.clone())
                .await
                .unwrap_or(false)
        };

        let input_seek_ms = if copy_safe { leading_gap_seek_ms } else { None };

        if !runtime.remux_workflow {
            if let Some(ms) = leading_gap_seek_ms {
                console_log(
                    "EXPORT|timing",
                    &format!(
                        "leading gap={}ms detected; using re-encode timestamp reset (no input seek) (input={})",
                        ms,
                        file_name_only(clip)
                    ),
                );
            }
        }

        per_copy_safe.push(copy_safe);
        per_input_seek_ms.push(input_seek_ms);
    }

    let jobs = build_clip_jobs(
        clips,
        destination_dir,
        &user_stem,
        &ext,
        &per_copy_safe,
        &per_input_seek_ms,
        &per_ms,
        &runtime.abort_requested,
    )?;

    let requested_parallel = runtime
        .export_options
        .as_ref()
        .map(|options| options.parallel_exports())
        .unwrap_or(1)
        .min(12);
    let gpu_parallel_limit = runtime.gpu_capabilities.max_parallel_exports.max(1) as usize;
    let capped_parallel = if uses_gpu_encoding(runtime.export_options.as_ref()) {
        requested_parallel.min(gpu_parallel_limit)
    } else {
        requested_parallel
    };
    let parallel_exports = capped_parallel.min(jobs.len().max(1));

    let mut exported_files = Vec::new();

    if parallel_exports <= 1 {
        let mut done_ms: u64 = 0;
        for job in jobs {
            if is_export_cancel_requested(&runtime.abort_requested) {
                return Err(export_canceled_error());
            }

            emit_export_progress(
                &runtime.app,
                10,
                &format!("Exporting clip {}/{}", job.index + 1, job.total),
                runtime.export_start_time,
            );

            match run_one_job(runtime, job, done_ms, total_ms, true).await {
                Ok((_index, output, clip_ms)) => {
                    done_ms = done_ms.saturating_add(clip_ms);
                    exported_files.push(output);
                }
                Err(error_text) => {
                    if is_canceled_error_text(&error_text) {
                        return Err(error_text);
                    }
                    return Err(error_text);
                }
            }
        }
    } else {
        console_log(
            "EXPORT|parallel",
            &format!("running {} parallel exports", parallel_exports),
        );
        emit_export_progress(
            &runtime.app,
            8,
            &format!("Starting parallel export ({parallel_exports} workers)..."),
            runtime.export_start_time,
        );

        let mut completed_outputs: Vec<(usize, String)> = Vec::new();
        let mut completed = 0usize;
        let mut current_parallel = parallel_exports;
        let mut pending_jobs = jobs;

        while !pending_jobs.is_empty() {
            if is_export_cancel_requested(&runtime.abort_requested) {
                return Err(export_canceled_error());
            }

            let allow_cpu_fallback = current_parallel <= 1;
            let mut gpu_retry_jobs: Vec<ClipExportJob> = Vec::new();

            if current_parallel != parallel_exports {
                console_log(
                    "EXPORT|parallel",
                    &format!(
                        "retrying {} failed clips with {} workers",
                        pending_jobs.len(),
                        current_parallel
                    ),
                );
            }

            for chunk in pending_jobs.chunks(current_parallel) {
                if is_export_cancel_requested(&runtime.abort_requested) {
                    return Err(export_canceled_error());
                }

                let selected_gpu_encoder_name =
                    selected_gpu_encoder(runtime, runtime.export_options.as_ref())
                        .map(str::to_string);
                let mut handles = Vec::with_capacity(chunk.len());
                for job in chunk.iter().cloned() {
                    let job_for_retry = job.clone();
                    let app_for_ffmpeg = runtime.app.clone();
                    let ffmpeg_clone = runtime.ffmpeg.clone();
                    let abort_requested_for_run = runtime.abort_requested.clone();
                    let active_pids_for_run = runtime.active_pids.clone();
                    let export_options_for_run = runtime.export_options.clone();
                    let gpu_encoder_for_run = selected_gpu_encoder_name.clone();
                    let start_time = runtime.export_start_time;
                    let copy_bsf_name = copy_bsf_for_job(runtime, &job.output).map(str::to_string);

                    let handle = tokio::task::spawn_blocking(move || {
                        if abort_requested_for_run.load(Ordering::SeqCst) {
                            return Err(export_canceled_error());
                        }

                        let msg = format!("Exporting clip {}/{}", job.index + 1, job.total);
                        let input_base = file_name_only(&job.input);
                        let output_base = file_name_only(&job.output);

                        let (mode_msg, args) = if job.copy_ok {
                            (
                                format!("{msg} (copy)"),
                                build_copy_args(
                                    &job.input,
                                    &job.output,
                                    export_options_for_run.as_ref(),
                                    job.input_seek_ms,
                                    copy_bsf_name.as_deref(),
                                ),
                            )
                        } else {
                            (
                                format!("{msg} (re-encode)"),
                                ffmpeg_reencode_args(
                                    &job.input,
                                    &job.output,
                                    export_options_for_run.as_ref(),
                                    job.input_seek_ms,
                                    gpu_encoder_for_run.as_deref(),
                                ),
                            )
                        };

                        console_log(
                            "EXPORT|clip",
                            &format!(
                                "{}/{} input={} output={} mode={}",
                                job.index + 1,
                                job.total,
                                input_base,
                                output_base,
                                if job.copy_ok { "copy" } else { "re-encode" }
                            ),
                        );

                        let first_result = run_ffmpeg_with_progress(
                            app_for_ffmpeg.clone(),
                            ffmpeg_clone.clone(),
                            args,
                            job.clip_total,
                            0,
                            None,
                            &mode_msg,
                            start_time,
                            abort_requested_for_run.clone(),
                            active_pids_for_run.clone(),
                            false,
                        );

                        if let Err(err) = first_result {
                            if job.copy_ok && !is_canceled_error_text(&err) {
                                console_log(
                                    "EXPORT|retry",
                                    &format!(
                                        "clip {}/{} stream copy failed; retry re-encode (input={} output={})",
                                        job.index + 1,
                                        job.total,
                                        input_base,
                                        output_base
                                    ),
                                );

                                let retry_args = ffmpeg_reencode_args(
                                    &job.input,
                                    &job.output,
                                    export_options_for_run.as_ref(),
                                    job.input_seek_ms,
                                    gpu_encoder_for_run.as_deref(),
                                );

                                let retry_result = run_ffmpeg_with_progress(
                                    app_for_ffmpeg.clone(),
                                    ffmpeg_clone.clone(),
                                    retry_args,
                                    job.clip_total,
                                    0,
                                    None,
                                    &format!("{msg} (re-encode)"),
                                    start_time,
                                    abort_requested_for_run.clone(),
                                    active_pids_for_run.clone(),
                                    false,
                                );

                                if let Err(retry_err) = retry_result {
                                    if is_canceled_error_text(&retry_err) {
                                        return Err(retry_err);
                                    }

                                    if allow_cpu_fallback
                                        && should_retry_reencode_on_cpu(
                                            &retry_err,
                                            export_options_for_run.as_ref(),
                                        )
                                    {
                                        console_log(
                                            "EXPORT|retry",
                                            &format!(
                                                "clip {}/{} gpu encoder init failed; retry re-encode on cpu (input={} output={})",
                                                job.index + 1,
                                                job.total,
                                                input_base,
                                                output_base
                                            ),
                                        );

                                        let cpu_options =
                                            to_cpu_options(export_options_for_run.as_ref());
                                        let cpu_retry_args = ffmpeg_reencode_args(
                                            &job.input,
                                            &job.output,
                                            cpu_options.as_ref(),
                                            job.input_seek_ms,
                                            None,
                                        );

                                        let cpu_retry_result = run_ffmpeg_with_progress(
                                            app_for_ffmpeg,
                                            ffmpeg_clone,
                                            cpu_retry_args,
                                            job.clip_total,
                                            0,
                                            None,
                                            &format!("{msg} (re-encode/cpu fallback)"),
                                            start_time,
                                            abort_requested_for_run,
                                            active_pids_for_run,
                                            false,
                                        );

                                        if let Err(cpu_err) = cpu_retry_result {
                                            if is_canceled_error_text(&cpu_err) {
                                                return Err(cpu_err);
                                            }
                                            return Err(format!(
                                                "FFmpeg export failed.\n(copy)\n{err}\n\n(re-encode)\n{retry_err}\n\n(cpu fallback)\n{cpu_err}"
                                            ));
                                        }
                                    } else {
                                        return Err(format!(
                                            "FFmpeg export failed.\n(copy)\n{err}\n\n(re-encode)\n{retry_err}"
                                        ));
                                    }
                                }
                            } else if is_canceled_error_text(&err) {
                                return Err(err);
                            } else if allow_cpu_fallback
                                && should_retry_reencode_on_cpu(
                                    &err,
                                    export_options_for_run.as_ref(),
                                )
                            {
                                console_log(
                                    "EXPORT|retry",
                                    &format!(
                                        "clip {}/{} gpu encoder init failed; retry re-encode on cpu (input={} output={})",
                                        job.index + 1,
                                        job.total,
                                        input_base,
                                        output_base
                                    ),
                                );

                                let cpu_options = to_cpu_options(export_options_for_run.as_ref());
                                let cpu_retry_args = ffmpeg_reencode_args(
                                    &job.input,
                                    &job.output,
                                    cpu_options.as_ref(),
                                    job.input_seek_ms,
                                    None,
                                );

                                let cpu_retry_result = run_ffmpeg_with_progress(
                                    app_for_ffmpeg,
                                    ffmpeg_clone,
                                    cpu_retry_args,
                                    job.clip_total,
                                    0,
                                    None,
                                    &format!("{msg} (re-encode/cpu fallback)"),
                                    start_time,
                                    abort_requested_for_run,
                                    active_pids_for_run,
                                    false,
                                );

                                if let Err(cpu_err) = cpu_retry_result {
                                    if is_canceled_error_text(&cpu_err) {
                                        return Err(cpu_err);
                                    }
                                    return Err(format!(
                                        "FFmpeg export failed.\n(gpu)\n{err}\n\n(cpu fallback)\n{cpu_err}"
                                    ));
                                }
                            } else {
                                return Err(format!("FFmpeg export failed: {err}"));
                            }
                        }

                        Ok::<(usize, String), String>((job.index, job.output))
                    });

                    handles.push((job_for_retry, handle));
                }

                for (job_for_retry, handle) in handles {
                    let result = handle
                        .await
                        .map_err(|e| format!("parallel export task failed: {e}"))?;

                    match result {
                        Ok((index, output)) => {
                            completed += 1;
                            completed_outputs.push((index, output));
                            let percent =
                                ((completed as f64 / clips.len() as f64) * 100.0).floor() as u8;
                            emit_export_progress(
                                &runtime.app,
                                percent,
                                &format!("Parallel export completed {completed}/{}", clips.len()),
                                runtime.export_start_time,
                            );
                        }
                        Err(error_text) => {
                            if is_canceled_error_text(&error_text) {
                                return Err(error_text);
                            }

                            if !allow_cpu_fallback
                                && should_retry_reencode_on_cpu(
                                    &error_text,
                                    runtime.export_options.as_ref(),
                                )
                            {
                                gpu_retry_jobs.push(job_for_retry);
                            } else {
                                return Err(error_text);
                            }
                        }
                    }
                }
            }

            if gpu_retry_jobs.is_empty() {
                break;
            }

            if current_parallel > 1 {
                current_parallel -= 1;
                console_log(
                    "EXPORT|parallel",
                    &format!(
                        "gpu encoder contention detected; lowering workers to {} for {} clips",
                        current_parallel,
                        gpu_retry_jobs.len()
                    ),
                );
                pending_jobs = gpu_retry_jobs;
            } else {
                return Err(
                    "GPU encoder contention persisted at 1 worker and CPU fallback did not recover."
                        .to_string(),
                );
            }
        }

        completed_outputs.sort_by_key(|(index, _)| *index);
        exported_files.extend(completed_outputs.into_iter().map(|(_, output)| output));
    }

    emit_export_progress(
        &runtime.app,
        100,
        "Export complete",
        runtime.export_start_time,
    );

    Ok(exported_files)
}
