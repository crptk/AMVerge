use std::io::Write;
use std::path::Path;
use std::sync::Arc;

use crate::utils::logging::{console_log, sanitize_for_console};
use crate::utils::paths::file_name_only;

use super::compat::append_container_codec_tag;
use super::encode::{
    append_audio_encode_args, append_video_encode_args, select_gpu_encoder_for_codec,
};
use super::probe::{clip_first_presented_frame_is_key, clip_video_start_ms, ffprobe_duration_ms};
use super::probe::clip_first_video_packet_is_copy_safe;
use super::progress::{
    emit_export_progress, export_canceled_error, is_canceled_error_text, is_export_cancel_requested,
};
use super::runner::run_ffmpeg_with_progress;
use super::types::ExportRuntime;

fn uses_gpu_encoding(runtime: &ExportRuntime) -> bool {
    matches!(
        runtime
            .export_options
            .as_ref()
            .map(|o| o.hardware_mode.as_str()),
        Some("auto") | Some("gpu")
    )
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

fn append_reencode_timing_args(args: &mut Vec<String>) {
    args.extend(["-fps_mode:v:0".to_string(), "cfr".to_string()]);
}

pub(super) async fn run_merge_export(
    runtime: &ExportRuntime,
    clips: &[String],
    save_path: &Path,
) -> Result<String, String> {
    use tempfile::NamedTempFile;

    if is_export_cancel_requested(&runtime.abort_requested) {
        return Err(export_canceled_error());
    }

    emit_export_progress(
        &runtime.app,
        0,
        "Merging clips...",
        runtime.export_start_time,
    );

    let out_str = save_path.to_str().ok_or("Invalid output path")?.to_string();

    emit_export_progress(
        &runtime.app,
        25,
        "Probing durations...",
        runtime.export_start_time,
    );

    let mut total_ms: Option<u64> = Some(0);
    for clip in clips {
        if is_export_cancel_requested(&runtime.abort_requested) {
            return Err(export_canceled_error());
        }
        match ffprobe_duration_ms(runtime.ffprobe.clone(), clip.clone()).await {
            Ok(Some(ms)) => {
                if let Some(total) = total_ms {
                    total_ms = Some(total.saturating_add(ms));
                }
            }
            _ => {
                total_ms = None;
                break;
            }
        }
    }

    emit_export_progress(
        &runtime.app,
        40,
        "Preparing file list...",
        runtime.export_start_time,
    );

    let mut filelist =
        NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;
    for clip in clips {
        if is_export_cancel_requested(&runtime.abort_requested) {
            return Err(export_canceled_error());
        }
        let safe_path = clip.replace("'", "'\\''");
        writeln!(filelist, "file '{}'", safe_path)
            .map_err(|e| format!("Failed to write to temp file: {e}"))?;
    }

    let filelist_path = filelist.path().to_string_lossy().to_string();

    emit_export_progress(&runtime.app, 50, "Merging...", runtime.export_start_time);

    let mut remux_precheck_note: Option<String> = None;
    if runtime.remux_workflow {
        for clip in clips {
            if is_export_cancel_requested(&runtime.abort_requested) {
                return Err(export_canceled_error());
            }

            let leading_gap_ms = clip_video_start_ms(runtime.ffprobe.clone(), clip.clone())
                .await
                .ok()
                .flatten();
            if let Some(ms) = leading_gap_ms.filter(|ms| *ms >= 1) {
                remux_precheck_note = Some(format!(
                    "leading gap={}ms detected on {}; will still try stream-copy merge first",
                    ms,
                    file_name_only(clip)
                ));
                break;
            }

            let starts_with_presentable_key =
                match clip_first_presented_frame_is_key(runtime.ffprobe.clone(), clip.clone())
                    .await
                {
                    Ok(Some(v)) => v,
                    Ok(None) | Err(_) => false,
                };
            if !starts_with_presentable_key {
                remux_precheck_note = Some(format!(
                    "first displayed frame is not key/I on {}; will still try stream-copy merge first",
                    file_name_only(clip)
                ));
                break;
            }

            let first_packet_copy_safe =
                match clip_first_video_packet_is_copy_safe(runtime.ffprobe.clone(), clip.clone())
                    .await
                {
                    Ok(Some(v)) => v,
                    Ok(None) | Err(_) => false,
                };
            if !first_packet_copy_safe {
                remux_precheck_note = Some(format!(
                    "first video packet not copy-safe (needs sync/preroll) on {}; will still try stream-copy merge first",
                    file_name_only(clip)
                ));
                break;
            }
        }
    }

    // Remux workflow should always attempt stream-copy first.
    // If ffmpeg copy fails, existing retry paths fallback to re-encode.
    let use_stream_copy = runtime.remux_workflow;

    if let Some(note) = &remux_precheck_note {
        console_log("EXPORT|merge", note);
    }

    // Segmented mode is reserved for re-encode merges.
    // For remux/stream-copy merges, use direct concat copy first (with existing fallback),
    // which provides steadier progress and avoids per-segment stall behavior.
    if clips.len() > 1 && !use_stream_copy {
        let parallel_workers = runtime
            .export_options
            .as_ref()
            .map(|o| o.parallel_exports())
            .unwrap_or(1)
            .min(12)
            .max(1);
        return run_segmented_merge(
            runtime,
            clips,
            save_path,
            parallel_workers,
            total_ms,
            use_stream_copy,
        )
        .await;
    }

    let mut args = vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        filelist_path.clone(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
    ];

    if use_stream_copy {
        args.extend(["-c:v".into(), "copy".into(), "-c:a".into(), "copy".into()]);
        let target_ext = save_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        if let Some(bsf) = super::compat::stream_copy_bsf_for(
            runtime.source_video_codec.as_deref(),
            &target_ext,
        ) {
            args.extend(["-bsf:v".into(), bsf.to_string()]);
            console_log(
                "EXPORT|bsf",
                &format!("merge stream-copy: applying {bsf} for .{target_ext}"),
            );
        }
    } else {
        let audio_mode = runtime
            .export_options
            .as_ref()
            .map(|options| options.audio_mode.as_str())
            .unwrap_or("aac");
        let selected_gpu_encoder = runtime.export_options.as_ref().and_then(|options| {
            select_gpu_encoder_for_codec(options.codec.as_str(), &runtime.gpu_capabilities)
        });

        args.extend(["-vf".into(), "setpts=PTS-STARTPTS".into()]);
        if audio_mode != "none" && audio_mode != "copy" {
            args.extend(["-af".into(), "asetpts=PTS-STARTPTS".into()]);
        }

        append_video_encode_args(
            &mut args,
            runtime.export_options.as_ref(),
            selected_gpu_encoder,
        );
        let ext_for_tag = save_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        let codec_for_tag = runtime
            .export_options
            .as_ref()
            .map(|o| o.codec.as_str())
            .unwrap_or("h264_high");
        append_container_codec_tag(&mut args, codec_for_tag, &ext_for_tag);
        append_reencode_timing_args(&mut args);
        append_audio_encode_args(&mut args, runtime.export_options.as_ref());
    }

    let ext = save_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "mp4" || ext == "mov" {
        args.push("-movflags".into());
        args.push("+faststart".into());
    }

    args.extend([
        "-max_muxing_queue_size".into(),
        "1024".into(),
        out_str.clone(),
    ]);

    let app_for_ffmpeg = runtime.app.clone();
    let ffmpeg_clone = runtime.ffmpeg.clone();
    let start_time = runtime.export_start_time;
    let abort_requested_for_run = runtime.abort_requested.clone();
    let active_pids_for_run = runtime.active_pids.clone();

    let run_result = tokio::task::spawn_blocking(move || {
        run_ffmpeg_with_progress(
            app_for_ffmpeg,
            ffmpeg_clone,
            args,
            total_ms,
            0,
            total_ms,
            "Merging",
            start_time,
            abort_requested_for_run,
            active_pids_for_run,
            true,
        )
    })
    .await
    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

    if let Err(error_text) = run_result {
        if is_canceled_error_text(&error_text) {
            return Err(error_text);
        }

        if use_stream_copy {
            console_log(
                "EXPORT|retry",
                "merge stream copy failed; retry merge re-encode",
            );

            let audio_mode = runtime
                .export_options
                .as_ref()
                .map(|options| options.audio_mode.as_str())
                .unwrap_or("aac");
            let selected_gpu_encoder = runtime.export_options.as_ref().and_then(|options| {
                select_gpu_encoder_for_codec(options.codec.as_str(), &runtime.gpu_capabilities)
            });

            let mut retry_args = vec![
                "-y".to_string(),
                "-f".to_string(),
                "concat".to_string(),
                "-safe".to_string(),
                "0".to_string(),
                "-i".to_string(),
                filelist_path.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "0:a?".to_string(),
                "-vf".to_string(),
                "setpts=PTS-STARTPTS".to_string(),
            ];
            if audio_mode != "none" && audio_mode != "copy" {
                retry_args.extend(["-af".to_string(), "asetpts=PTS-STARTPTS".to_string()]);
            }

            append_video_encode_args(
                &mut retry_args,
                runtime.export_options.as_ref(),
                selected_gpu_encoder,
            );
            {
                let codec_for_tag = runtime
                    .export_options
                    .as_ref()
                    .map(|o| o.codec.as_str())
                    .unwrap_or("h264_high");
                append_container_codec_tag(&mut retry_args, codec_for_tag, &ext);
            }
            append_reencode_timing_args(&mut retry_args);
            append_audio_encode_args(&mut retry_args, runtime.export_options.as_ref());

            if ext == "mp4" || ext == "mov" {
                retry_args.extend(["-movflags".to_string(), "+faststart".to_string()]);
            }

            retry_args.extend([
                "-max_muxing_queue_size".to_string(),
                "1024".to_string(),
                out_str.clone(),
            ]);

            let app_for_ffmpeg = runtime.app.clone();
            let ffmpeg_clone = runtime.ffmpeg.clone();
            let start_time = runtime.export_start_time;
            let abort_requested_for_run = runtime.abort_requested.clone();
            let active_pids_for_run = runtime.active_pids.clone();

            let retry_result = tokio::task::spawn_blocking(move || {
                run_ffmpeg_with_progress(
                    app_for_ffmpeg,
                    ffmpeg_clone,
                    retry_args,
                    total_ms,
                    0,
                    total_ms,
                    "Merging (re-encode fallback)",
                    start_time,
                    abort_requested_for_run,
                    active_pids_for_run,
                    true,
                )
            })
            .await
            .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

            if let Err(retry_error_text) = retry_result {
                if is_canceled_error_text(&retry_error_text) {
                    return Err(retry_error_text);
                }

                if uses_gpu_encoding(runtime) && is_gpu_session_open_error(&retry_error_text) {
                    console_log(
                        "EXPORT|retry",
                        "merge re-encode gpu init failed; retry merge re-encode on cpu",
                    );

                    let mut cpu_options = runtime.export_options.clone();
                    if let Some(options) = cpu_options.as_mut() {
                        options.hardware_mode = "cpu".to_string();
                    }

                    let mut cpu_args = vec![
                        "-y".to_string(),
                        "-f".to_string(),
                        "concat".to_string(),
                        "-safe".to_string(),
                        "0".to_string(),
                        "-i".to_string(),
                        filelist_path.clone(),
                        "-map".to_string(),
                        "0:v:0".to_string(),
                        "-map".to_string(),
                        "0:a?".to_string(),
                        "-vf".to_string(),
                        "setpts=PTS-STARTPTS".to_string(),
                    ];
                    let cpu_audio_mode = cpu_options
                        .as_ref()
                        .map(|options| options.audio_mode.as_str())
                        .unwrap_or("aac");
                    if cpu_audio_mode != "none" && cpu_audio_mode != "copy" {
                        cpu_args.extend(["-af".to_string(), "asetpts=PTS-STARTPTS".to_string()]);
                    }

                    append_video_encode_args(&mut cpu_args, cpu_options.as_ref(), None);
                    {
                        let codec_for_tag = cpu_options
                            .as_ref()
                            .map(|o| o.codec.as_str())
                            .unwrap_or("h264_high");
                        append_container_codec_tag(&mut cpu_args, codec_for_tag, &ext);
                    }
                    append_reencode_timing_args(&mut cpu_args);
                    append_audio_encode_args(&mut cpu_args, cpu_options.as_ref());

                    if ext == "mp4" || ext == "mov" {
                        cpu_args.extend(["-movflags".to_string(), "+faststart".to_string()]);
                    }

                    cpu_args.extend([
                        "-max_muxing_queue_size".to_string(),
                        "1024".to_string(),
                        out_str.clone(),
                    ]);

                    let app_for_ffmpeg = runtime.app.clone();
                    let ffmpeg_clone = runtime.ffmpeg.clone();
                    let start_time = runtime.export_start_time;
                    let abort_requested_for_run = runtime.abort_requested.clone();
                    let active_pids_for_run = runtime.active_pids.clone();
                    let cpu_retry_result = tokio::task::spawn_blocking(move || {
                        run_ffmpeg_with_progress(
                            app_for_ffmpeg,
                            ffmpeg_clone,
                            cpu_args,
                            total_ms,
                            0,
                            total_ms,
                            "Merging (cpu fallback)",
                            start_time,
                            abort_requested_for_run,
                            active_pids_for_run,
                            true,
                        )
                    })
                    .await
                    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

                    if let Err(cpu_error_text) = cpu_retry_result {
                        if is_canceled_error_text(&cpu_error_text) {
                            return Err(cpu_error_text);
                        }
                        return Err(format!(
                            "FFmpeg merge failed.\n(copy)\n{error_text}\n\n(re-encode)\n{retry_error_text}\n\n(cpu fallback)\n{cpu_error_text}"
                        ));
                    }
                } else {
                    return Err(format!(
                        "FFmpeg merge failed.\n(copy)\n{error_text}\n\n(re-encode)\n{retry_error_text}"
                    ));
                }
            }

            emit_export_progress(
                &runtime.app,
                100,
                "Export complete",
                runtime.export_start_time,
            );

            return Ok(out_str);
        }

        if !use_stream_copy && uses_gpu_encoding(runtime) && is_gpu_session_open_error(&error_text)
        {
            console_log(
                "EXPORT|retry",
                "merge gpu encoder init failed; retry merge re-encode on cpu",
            );

            let mut cpu_options = runtime.export_options.clone();
            if let Some(options) = cpu_options.as_mut() {
                options.hardware_mode = "cpu".to_string();
            }

            let mut cpu_args = vec![
                "-y".to_string(),
                "-f".to_string(),
                "concat".to_string(),
                "-safe".to_string(),
                "0".to_string(),
                "-i".to_string(),
                filelist_path.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "0:a?".to_string(),
                "-vf".to_string(),
                "setpts=PTS-STARTPTS".to_string(),
            ];
            let cpu_audio_mode = cpu_options
                .as_ref()
                .map(|options| options.audio_mode.as_str())
                .unwrap_or("aac");
            if cpu_audio_mode != "none" && cpu_audio_mode != "copy" {
                cpu_args.extend(["-af".to_string(), "asetpts=PTS-STARTPTS".to_string()]);
            }

            append_video_encode_args(&mut cpu_args, cpu_options.as_ref(), None);
            {
                let codec_for_tag = cpu_options
                    .as_ref()
                    .map(|o| o.codec.as_str())
                    .unwrap_or("h264_high");
                append_container_codec_tag(&mut cpu_args, codec_for_tag, &ext);
            }
            append_reencode_timing_args(&mut cpu_args);
            append_audio_encode_args(&mut cpu_args, cpu_options.as_ref());

            if ext == "mp4" || ext == "mov" {
                cpu_args.extend(["-movflags".to_string(), "+faststart".to_string()]);
            }

            cpu_args.extend([
                "-max_muxing_queue_size".to_string(),
                "1024".to_string(),
                out_str.clone(),
            ]);

            let app_for_ffmpeg = runtime.app.clone();
            let ffmpeg_clone = runtime.ffmpeg.clone();
            let start_time = runtime.export_start_time;
            let abort_requested_for_run = runtime.abort_requested.clone();
            let active_pids_for_run = runtime.active_pids.clone();
            let cpu_retry_result = tokio::task::spawn_blocking(move || {
                run_ffmpeg_with_progress(
                    app_for_ffmpeg,
                    ffmpeg_clone,
                    cpu_args,
                    total_ms,
                    0,
                    total_ms,
                    "Merging (cpu fallback)",
                    start_time,
                    abort_requested_for_run,
                    active_pids_for_run,
                    true,
                )
            })
            .await
            .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

            if let Err(cpu_error_text) = cpu_retry_result {
                if is_canceled_error_text(&cpu_error_text) {
                    return Err(cpu_error_text);
                }
                return Err(format!(
                    "FFmpeg merge failed.\n(gpu)\n{error_text}\n\n(cpu fallback)\n{cpu_error_text}"
                ));
            }

            emit_export_progress(
                &runtime.app,
                100,
                "Export complete",
                runtime.export_start_time,
            );

            return Ok(out_str);
        }

        console_log(
            "ERROR|export_clips",
            &format!("merge failed: {}", sanitize_for_console(&error_text)),
        );
        return Err(format!("FFmpeg merge failed: {error_text}"));
    }

    emit_export_progress(
        &runtime.app,
        100,
        "Export complete",
        runtime.export_start_time,
    );

    Ok(out_str)
}

fn build_merge_segment_args(
    input: &str,
    output: &str,
    options: Option<&super::types::ExportOptionsPayload>,
    gpu_encoder: Option<&str>,
    codec_for_tag: &str,
    audio_mode: &str,
    ext: &str,
    stream_copy: bool,
    source_video_codec: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a?".to_string(),
    ];

    if stream_copy {
        args.extend([
            "-c:v".to_string(),
            "copy".to_string(),
            "-c:a".to_string(),
            "copy".to_string(),
        ]);
        if let Some(bsf) = super::compat::stream_copy_bsf_for(source_video_codec, ext) {
            args.extend(["-bsf:v".to_string(), bsf.to_string()]);
        }
    } else {
        args.extend(["-vf".to_string(), "setpts=PTS-STARTPTS".to_string()]);
        if audio_mode != "none" && audio_mode != "copy" {
            args.extend(["-af".to_string(), "asetpts=PTS-STARTPTS".to_string()]);
        }
        append_video_encode_args(&mut args, options, gpu_encoder);
        append_container_codec_tag(&mut args, codec_for_tag, ext);
        append_reencode_timing_args(&mut args);
        append_audio_encode_args(&mut args, options);
    }

    args.extend([
        "-max_muxing_queue_size".to_string(),
        "1024".to_string(),
        output.to_string(),
    ]);
    args
}

async fn run_segmented_merge(
    runtime: &ExportRuntime,
    clips: &[String],
    save_path: &Path,
    requested_workers: usize,
    total_ms: Option<u64>,
    stream_copy: bool,
) -> Result<String, String> {
    use std::sync::Mutex as StdMutex;
    use tempfile::{tempdir, NamedTempFile};

    let out_str = save_path.to_str().ok_or("Invalid output path")?.to_string();
    let ext = save_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("mp4")
        .to_lowercase();

    let temp_dir = tempdir().map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let segment_paths: Vec<String> = (0..clips.len())
        .map(|i| {
            temp_dir
                .path()
                .join(format!("seg_{:04}.{}", i, ext))
                .to_string_lossy()
                .to_string()
        })
        .collect();

    let gpu_encoder_name = runtime
        .export_options
        .as_ref()
        .and_then(|opts| {
            select_gpu_encoder_for_codec(opts.codec.as_str(), &runtime.gpu_capabilities)
        })
        .map(str::to_string);
    let codec_for_tag = runtime
        .export_options
        .as_ref()
        .map(|o| o.codec.clone())
        .unwrap_or_else(|| "h264_high".to_string());
    let audio_mode_str = runtime
        .export_options
        .as_ref()
        .map(|o| o.audio_mode.clone())
        .unwrap_or_else(|| "aac".to_string());

    let gpu_in_use = !stream_copy && uses_gpu_encoding(runtime) && gpu_encoder_name.is_some();
    let gpu_limit = runtime.gpu_capabilities.max_parallel_exports.max(1) as usize;
    let mut workers = if gpu_in_use {
        requested_workers.min(gpu_limit)
    } else {
        requested_workers
    };
    workers = workers.min(clips.len()).max(1);
    let source_video_codec = runtime.source_video_codec.clone();

    let mode_label = if stream_copy { "remux" } else { "encode" };
    console_log(
        "EXPORT|merge_segmented",
        &format!(
            "{} {} segments with {} workers (gpu_in_use={}, stream_copy={})",
            mode_label,
            clips.len(),
            workers,
            gpu_in_use,
            stream_copy
        ),
    );
    let action_word = if stream_copy { "Remuxing" } else { "Encoding" };
    emit_export_progress(
        &runtime.app,
        10,
        &format!(
            "{} {} segments ({} workers)...",
            action_word,
            clips.len(),
            workers
        ),
        runtime.export_start_time,
    );

    let total = clips.len();
    let completed_counter = Arc::new(StdMutex::new(0usize));

    let mut idx = 0usize;
    while idx < clips.len() {
        if is_export_cancel_requested(&runtime.abort_requested) {
            return Err(export_canceled_error());
        }

        let chunk_end = (idx + workers).min(clips.len());
        let mut handles = Vec::with_capacity(chunk_end - idx);

        for clip_idx in idx..chunk_end {
            let input = clips[clip_idx].clone();
            let output = segment_paths[clip_idx].clone();
            let app = runtime.app.clone();
            let ffmpeg = runtime.ffmpeg.clone();
            let abort = runtime.abort_requested.clone();
            let pids = runtime.active_pids.clone();
            let opts = runtime.export_options.clone();
            let gpu_enc = gpu_encoder_name.clone();
            let codec = codec_for_tag.clone();
            let audio_mode = audio_mode_str.clone();
            let ext_clone = ext.clone();
            let start = runtime.export_start_time;
            let counter = completed_counter.clone();
            let app_for_progress = runtime.app.clone();
            let src_codec = source_video_codec.clone();
            let segment_stream_copy = stream_copy;

            let handle = tokio::task::spawn_blocking(move || {
                let args = build_merge_segment_args(
                    &input,
                    &output,
                    opts.as_ref(),
                    gpu_enc.as_deref(),
                    &codec,
                    &audio_mode,
                    &ext_clone,
                    segment_stream_copy,
                    src_codec.as_deref(),
                );
                let verb = if segment_stream_copy { "Remuxing" } else { "Encoding" };
                let label = format!("{} segment {}/{}", verb, clip_idx + 1, total);
                let result = run_ffmpeg_with_progress(
                    app.clone(),
                    ffmpeg.clone(),
                    args,
                    None,
                    0,
                    None,
                    &label,
                    start,
                    abort.clone(),
                    pids.clone(),
                    false,
                );

                if let Err(err) = result {
                    if is_canceled_error_text(&err) {
                        return Err(err);
                    }

                    // Stream-copy segment failed: fall back to re-encode for
                    // this segment (matches the legacy whole-merge fallback).
                    if segment_stream_copy {
                        let reenc_args = build_merge_segment_args(
                            &input,
                            &output,
                            opts.as_ref(),
                            gpu_enc.as_deref(),
                            &codec,
                            &audio_mode,
                            &ext_clone,
                            false,
                            src_codec.as_deref(),
                        );
                        let reenc_label = format!(
                            "Encoding segment {}/{} (re-encode fallback)",
                            clip_idx + 1,
                            total
                        );
                        let reenc_result = run_ffmpeg_with_progress(
                            app.clone(),
                            ffmpeg.clone(),
                            reenc_args,
                            None,
                            0,
                            None,
                            &reenc_label,
                            start,
                            abort.clone(),
                            pids.clone(),
                            false,
                        );
                        if let Err(reenc_err) = reenc_result {
                            if is_canceled_error_text(&reenc_err) {
                                return Err(reenc_err);
                            }
                            // Re-encode also failed — try CPU if GPU was used.
                            if gpu_enc.is_some() && is_gpu_session_open_error(&reenc_err) {
                                let mut cpu_opts = opts.clone();
                                if let Some(o) = cpu_opts.as_mut() {
                                    o.hardware_mode = "cpu".to_string();
                                }
                                let cpu_args = build_merge_segment_args(
                                    &input,
                                    &output,
                                    cpu_opts.as_ref(),
                                    None,
                                    &codec,
                                    &audio_mode,
                                    &ext_clone,
                                    false,
                                    src_codec.as_deref(),
                                );
                                let cpu_label = format!(
                                    "Encoding segment {}/{} (cpu fallback)",
                                    clip_idx + 1,
                                    total
                                );
                                let cpu_result = run_ffmpeg_with_progress(
                                    app, ffmpeg, cpu_args, None, 0, None, &cpu_label, start,
                                    abort, pids, false,
                                );
                                if let Err(cpu_err) = cpu_result {
                                    return Err(format!(
                                        "Segment {} failed.\n(copy)\n{}\n\n(re-encode)\n{}\n\n(cpu fallback)\n{}",
                                        clip_idx + 1, err, reenc_err, cpu_err
                                    ));
                                }
                            } else {
                                return Err(format!(
                                    "Segment {} failed.\n(copy)\n{}\n\n(re-encode)\n{}",
                                    clip_idx + 1,
                                    err,
                                    reenc_err
                                ));
                            }
                        }
                    } else if gpu_enc.is_some() && is_gpu_session_open_error(&err) {
                        let mut cpu_opts = opts.clone();
                        if let Some(o) = cpu_opts.as_mut() {
                            o.hardware_mode = "cpu".to_string();
                        }
                        let cpu_args = build_merge_segment_args(
                            &input,
                            &output,
                            cpu_opts.as_ref(),
                            None,
                            &codec,
                            &audio_mode,
                            &ext_clone,
                            false,
                            src_codec.as_deref(),
                        );
                        let cpu_label = format!(
                            "Encoding segment {}/{} (cpu fallback)",
                            clip_idx + 1,
                            total
                        );
                        let cpu_result = run_ffmpeg_with_progress(
                            app, ffmpeg, cpu_args, None, 0, None, &cpu_label, start, abort,
                            pids, false,
                        );
                        if let Err(cpu_err) = cpu_result {
                            return Err(format!(
                                "Segment {} failed.\n(gpu)\n{}\n\n(cpu fallback)\n{}",
                                clip_idx + 1,
                                err,
                                cpu_err
                            ));
                        }
                    } else {
                        return Err(format!("Segment {} failed: {}", clip_idx + 1, err));
                    }
                }

                let done = if let Ok(mut c) = counter.lock() {
                    *c += 1;
                    *c
                } else {
                    0
                };
                if done > 0 {
                    // Reserve 10..85 percent for segment work; concat gets 85..100.
                    let percent = 10 + ((done as f64 / total as f64) * 75.0) as u8;
                    let verb_done = if segment_stream_copy { "Remuxed" } else { "Encoded" };
                    emit_export_progress(
                        &app_for_progress,
                        percent,
                        &format!("{} {}/{} segments", verb_done, done, total),
                        start,
                    );
                }

                Ok::<usize, String>(clip_idx)
            });
            handles.push(handle);
        }

        for h in handles {
            let join_result = h
                .await
                .map_err(|e| format!("merge worker task failed: {e}"))?;
            join_result?;
        }

        idx = chunk_end;
    }

    if is_export_cancel_requested(&runtime.abort_requested) {
        return Err(export_canceled_error());
    }

    emit_export_progress(
        &runtime.app,
        88,
        "Concatenating segments...",
        runtime.export_start_time,
    );

    let mut filelist =
        NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;
    for seg in &segment_paths {
        let safe = seg.replace('\'', "'\\''");
        writeln!(filelist, "file '{}'", safe)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
    }
    let filelist_path = filelist.path().to_string_lossy().to_string();

    let mut concat_args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        filelist_path,
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a?".to_string(),
        "-c".to_string(),
        "copy".to_string(),
    ];
    if ext == "mp4" || ext == "mov" {
        concat_args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }
    concat_args.extend([
        "-max_muxing_queue_size".to_string(),
        "1024".to_string(),
        out_str.clone(),
    ]);

    let app_for_concat = runtime.app.clone();
    let ffmpeg_for_concat = runtime.ffmpeg.clone();
    let abort_for_concat = runtime.abort_requested.clone();
    let pids_for_concat = runtime.active_pids.clone();
    let start_for_concat = runtime.export_start_time;
    let concat_result = tokio::task::spawn_blocking(move || {
        run_ffmpeg_with_progress(
            app_for_concat,
            ffmpeg_for_concat,
            concat_args,
            total_ms,
            0,
            total_ms,
            "Concatenating segments",
            start_for_concat,
            abort_for_concat,
            pids_for_concat,
            true,
        )
    })
    .await
    .map_err(|e| format!("concat task panicked: {e}"))?;

    if let Err(err) = concat_result {
        if is_canceled_error_text(&err) {
            return Err(err);
        }
        return Err(format!("FFmpeg final concat failed: {err}"));
    }

    emit_export_progress(
        &runtime.app,
        100,
        "Export complete",
        runtime.export_start_time,
    );

    drop(temp_dir);
    Ok(out_str)
}


