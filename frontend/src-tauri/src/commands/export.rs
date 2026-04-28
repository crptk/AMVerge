use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::payloads::ProgressPayload;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::{console_log, sanitize_for_console};
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

#[tauri::command]
pub async fn export_clips(
    app: AppHandle,
    clips: Vec<String>,
    save_path: String,
    merge_enabled: bool,
) -> Result<(), String> {
    if clips.is_empty() {
        return Ok(());
    }

    console_log(
        "EXPORT|start",
        &format!(
            "merge_enabled={} clips={} dest={}",
            merge_enabled,
            clips.len(),
            file_name_only(&save_path)
        ),
    );

    // Export uses FFmpeg.
    // - merge_enabled: prefer concat demuxer + stream copy (fast), with fallback to re-encode for compatibility
    // - else: per-clip export prefers stream copy when already AE-friendly, else re-encodes for compatibility
    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    
    let mut save_path = PathBuf::from(&save_path);
    let export_start_time = Instant::now();

    // If the user gave a path without an extension (or a template-ish name), default to mp4.
    if save_path.extension().is_none() {
        save_path.set_extension("mp4");
    }

    // Ensure destination directory exists for both merge and multi-export.
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    fn format_elapsed(start_time: Instant) -> String {
        let secs = start_time.elapsed().as_secs();
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;

        if h > 0 {
            format!("{:02}:{:02}:{:02}", h, m, s)
        } else {
            format!("{:02}:{:02}", m, s)
        }
    }

    fn emit_export_progress(app: &AppHandle, percent: u8, message: &str, start_time: Instant) {
        let p = percent.min(100);
        let msg = format!(
            "{} ({} elapsed)",
            message.replace('\n', " ").replace('\r', " "),
            format_elapsed(start_time)
        );

        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: p,
                message: msg.clone(),
            },
        );
    }

    async fn ffprobe_duration_ms(ffprobe: PathBuf, path: String) -> Result<Option<u64>, String> {
        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&ffprobe);
            apply_no_window(&mut cmd);
            let out = cmd
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=nk=1:nw=1",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

            if !out.status.success() {
                return Ok(None);
            }

            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                return Ok(None);
            }

            let secs: f64 = s
                .parse()
                .map_err(|_| "ffprobe duration parse failed".to_string())?;
            if !secs.is_finite() || secs <= 0.0 {
                return Ok(None);
            }
            Ok(Some((secs * 1000.0).round() as u64))
        })
        .await
        .map_err(|e| format!("ffprobe task panicked: {e}"))?
    }

    async fn ffprobe_codec_name(
        ffprobe: PathBuf,
        path: String,
        stream_selector: &'static str,
    ) -> Result<Option<String>, String> {
        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&ffprobe);
            apply_no_window(&mut cmd);
            let out = cmd
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    stream_selector,
                    "-show_entries",
                    "stream=codec_name",
                    "-of",
                    "default=nk=1:nw=1",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

            if !out.status.success() {
                return Ok(None);
            }

            let s = String::from_utf8_lossy(&out.stdout)
                .trim()
                .to_ascii_lowercase();
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(s))
            }
        })
        .await
        .map_err(|e| format!("ffprobe task panicked: {e}"))?
    }

    async fn is_ae_copy_safe(ffprobe: PathBuf, clip_path: String) -> Result<bool, String> {
        // "Safe" here means: if we stream-copy, AE is likely to import.
        // We keep it conservative: H.264 video and AAC-or-no-audio.
        let v = ffprobe_codec_name(ffprobe.clone(), clip_path.clone(), "v:0").await?;
        if v.as_deref() != Some("h264") {
            return Ok(false);
        }
        let a = ffprobe_codec_name(ffprobe, clip_path, "a:0").await?;
        Ok(a.is_none() || a.as_deref() == Some("aac"))
    }

    fn run_ffmpeg_with_progress(
        app: AppHandle,
        ffmpeg: PathBuf,
        mut args: Vec<String>,
        total_ms: Option<u64>,
        completed_ms: u64,
        grand_total_ms: Option<u64>,
        message_prefix: &str,
        start_time: Instant,
    ) -> Result<(), String> {
        // Force progress to stderr so we can parse it (while still receiving real errors).
        // Note: ffmpeg writes key=value lines like out_time_ms=..., progress=continue/end.
        args.insert(0, "-hide_banner".into());
        args.insert(0, "-nostats".into());
        args.insert(0, "pipe:2".into());
        args.insert(0, "-progress".into());

        let mut cmd = Command::new(&ffmpeg);
        apply_no_window(&mut cmd);
        let mut child = cmd
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg ({}): {e}", ffmpeg.display()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture ffmpeg stderr")?;
        let reader = BufReader::new(stderr);

        let mut stderr_accum = String::new();
        let mut last_emit = Instant::now() - Duration::from_secs(5);
        let mut last_percent: Option<u8> = None;

        for line in reader.lines().flatten() {
            stderr_accum.push_str(&line);
            stderr_accum.push('\n');

            let line_trim = line.trim();
            if let Some(v) = line_trim.strip_prefix("out_time_ms=") {
                if let Ok(_out_ms) = v.parse::<u64>() {
                    // Show elapsed time since start
                    let elapsed = start_time.elapsed();
                    let secs = elapsed.as_secs();
                    let h = secs / 3600;
                    let m = (secs % 3600) / 60;
                    let s = secs % 60;
                    let elapsed_str = if h > 0 {
                        format!("{:02}:{:02}:{:02}", h, m, s)
                    } else {
                        format!("{:02}:{:02}", m, s)
                    };
                    let progress_msg = format!("{message_prefix} ({} elapsed)", elapsed_str);

                    // percent is still calculated for the progress bar
                    let denom_ms = grand_total_ms.or(total_ms).unwrap_or(0);
                    let overall_ms = completed_ms.saturating_add(_out_ms.min(total_ms.unwrap_or(_out_ms)));
                    let mut percent = if denom_ms > 0 {
                        ((overall_ms as f64 / denom_ms as f64) * 100.0).floor() as i32
                    } else {
                        0
                    };
                    percent = percent.clamp(0, 99);
                    let p = percent as u8;

                    let should_emit =
                        last_percent != Some(p) || last_emit.elapsed() > Duration::from_secs(1);

                    if should_emit {
                        last_emit = Instant::now();
                        last_percent = Some(p);

                        let _ = app.emit(
                            "scene_progress",
                            ProgressPayload {
                                percent: p,
                                message: progress_msg,
                            },
                        );
                    }
                }
            }

            if line_trim == "progress=end" {
                break;
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;

        if !status.success() {
            // On failure, dump ffmpeg stderr to console (screenshot-friendly).
            let mut err = stderr_accum.clone();

            // Best-effort redact input/output paths down to filenames.
            let mut inputs: Vec<String> = Vec::new();
            for i in 0..args.len().saturating_sub(1) {
                if args[i] == "-i" {
                    inputs.push(args[i + 1].clone());
                }
            }
            let output = args.last().cloned();
            for p in inputs.into_iter().chain(output.into_iter()) {
                let base = file_name_only(&p);
                if !p.is_empty() && p != base {
                    err = err.replace(&p, &base);
                }
            }

            console_log(
                "FFMPEG|failed",
                &format!("{} status={}", ffmpeg.display(), status),
            );
            for l in err.lines() {
                if !l.trim().is_empty() {
                    console_log("FFMPEG", l);
                }
            }

            let err = err.trim().to_string();
            return Err(if err.is_empty() {
                format!("FFmpeg failed ({})", ffmpeg.display())
            } else {
                err
            });
        }

        // Successful run; emit a small step forward (caller may emit 100 at the end).
        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: 80,
                message: format!("{message_prefix}"),
            },
        );

        Ok(())
    }

    fn ffmpeg_reencode_ae_args(input: &str, output: &str) -> Vec<String> {
        // Timestamp normalization + re-encode to broadly compatible H.264/AAC.
        // This avoids common NLE import issues (black frames, odd timebases, missing PTS).
        let mut args = vec![
            "-y".to_string(),
            "-i".to_string(),
            input.to_string(),
            "-fflags".to_string(),
            "+genpts".to_string(),
            "-avoid_negative_ts".to_string(),
            "make_zero".to_string(),
            // Video
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-profile:v".to_string(),
            "high".to_string(),
            "-level".to_string(),
            "4.1".to_string(),
            "-preset".to_string(),
            "medium".to_string(),
            "-crf".to_string(),
            "18".to_string(),
            // Audio
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-ar".to_string(),
            "48000".to_string(),
            "-ac".to_string(),
            "2".to_string(),
        ];

        // MP4/MOV faststart
        let ext = Path::new(output)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "mp4" || ext == "mov" {
            args.push("-movflags".to_string());
            args.push("+faststart".to_string());
        }

        // Avoid rare muxing queue overflows on tricky inputs.
        args.push("-max_muxing_queue_size".to_string());
        args.push("1024".to_string());
        args.push(output.to_string());

        args
    }

    if merge_enabled {
        // ---------------- MERGE ----------------


        use std::io::Write;
        use tempfile::NamedTempFile;

        emit_export_progress(&app, 0, "Merging clips...", export_start_time);

        let out_str = save_path.to_str().ok_or("Invalid output path")?.to_string();

        // Best-effort total duration for progress.
        emit_export_progress(&app, 25, "Probing durations...", export_start_time);
        let mut total_ms: Option<u64> = Some(0);
        for c in &clips {
            match ffprobe_duration_ms(ffprobe.clone(), c.clone()).await {
                Ok(Some(ms)) => {
                    if let Some(t) = total_ms {
                        total_ms = Some(t.saturating_add(ms));
                    }
                }
                _ => {
                    total_ms = None;
                    break;
                }
            }
        }

        // Write file list for ffmpeg concat demuxer
        emit_export_progress(&app, 40, "Preparing file list...", export_start_time);
        let mut filelist = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;
        for c in &clips {
            // ffmpeg concat demuxer requires each line: file 'path'
            // Escape single quotes in paths
            let safe_path = c.replace("'", "'\\''");
            writeln!(filelist, "file '{}'", safe_path).map_err(|e| format!("Failed to write to temp file: {e}"))?;
        }
        let filelist_path = filelist.path().to_string_lossy().to_string();

        emit_export_progress(&app, 50, "Merging...", export_start_time);

        let mut args = vec![
            "-y".into(),
            "-f".into(),
            "concat".into(),
            "-safe".into(),
            "0".into(),
            "-i".into(),
            filelist_path.clone(),
            // Video/audio re-encode for compatibility
            "-fflags".into(),
            "+genpts".into(),
            "-avoid_negative_ts".into(),
            "make_zero".into(),
            "-c:v".into(),
            "libx264".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-profile:v".into(),
            "high".into(),
            "-level".into(),
            "4.1".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "18".into(),
        ];

        let ext = save_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "mp4" || ext == "mov" {
            args.push("-movflags".into());
            args.push("+faststart".into());
        }

        args.extend([
            "-max_muxing_queue_size".into(),
            "1024".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
            out_str.clone(),
        ]);

        let app_for_ffmpeg = app.clone();
        let ffmpeg_clone = ffmpeg.clone();
        let total_ms_f = total_ms;
        let start_time = export_start_time;
        let out = tokio::task::spawn_blocking(move || {
            run_ffmpeg_with_progress(
                app_for_ffmpeg,
                ffmpeg_clone,
                args,
                total_ms_f,
                0,
                total_ms_f,
                "Merging",
                start_time,
            )
        })
        .await
        .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

        if let Err(e) = out {
            console_log(
                "ERROR|export_clips",
                &format!("merge failed: {}", sanitize_for_console(&e)),
            );
            return Err(format!("FFmpeg merge failed: {e}"));
        }

        emit_export_progress(&app, 100, "Export complete", export_start_time);
    } else {
        // ---------------- MULTIPLE EXPORT ----------------

        // In merge-disabled mode, the frontend passes a *file path* chosen via a Save dialog.
        // We treat it as a naming template: <user_stem>_<clip_code>.<ext>
        let destination_dir = save_path.parent().ok_or("Invalid save path")?;
        let user_stem = save_path
            .file_stem()
            .ok_or("Invalid filename")?
            .to_string_lossy()
            .to_string();

        let ext = save_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4")
            .to_string();

        // Probe durations once to produce smooth overall progress.
        emit_export_progress(&app, 5, "Probing clip info...", export_start_time);
        let mut per_ms: Vec<Option<u64>> = Vec::with_capacity(clips.len());
        let mut total_ms: Option<u64> = Some(0);
        // Pre-cache codec info alongside durations to avoid redundant ffprobe calls per clip.
        let mut per_copy_safe: Vec<bool> = Vec::with_capacity(clips.len());
        for c in &clips {
            let d = ffprobe_duration_ms(ffprobe.clone(), c.clone())
                .await
                .ok()
                .flatten();
            per_ms.push(d);
            if let (Some(t), Some(ms)) = (total_ms, d) {
                total_ms = Some(t.saturating_add(ms));
            } else {
                total_ms = None;
            }
            let safe = is_ae_copy_safe(ffprobe.clone(), c.clone())
                .await
                .unwrap_or(false);
            per_copy_safe.push(safe);
        }

        let mut done_ms: u64 = 0;
        for (i, clip) in clips.iter().enumerate() {
            let clip_path = Path::new(clip);
            let clip_stem = clip_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");

            let clip_code = clip_stem
                .rsplit('_')
                .next()
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| "0000");

            // If the code isn't purely digits (unexpected naming), fall back to index.
            let code = if clip_code.chars().all(|c| c.is_ascii_digit()) {
                clip_code.to_string()
            } else {
                format!("{:04}", i)
            };

            // Support the frontend's `####` placeholder: `base_####.mp4` -> `base_0001.mp4`.
            // If not present, fall back to `base_<code>.mp4`.
            let file_stem = if user_stem.contains("####") {
                user_stem.replace("####", &code)
            } else {
                format!("{}_{}", user_stem, code)
            };

            let destination = destination_dir.join(format!("{}.{}", file_stem, ext));

            let input_str = clip_path.to_str().ok_or("Invalid clip path")?;
            let output_str = destination.to_str().ok_or("Invalid destination path")?;

            let msg = format!("Exporting clip {}/{}", i + 1, clips.len());
            emit_export_progress(&app, 10, &msg, export_start_time);

            // Use pre-cached codec info instead of re-probing each clip.
            let copy_ok = per_copy_safe.get(i).copied().unwrap_or(false);
            let clip_total = per_ms.get(i).copied().flatten();

            let (mode_msg, args) = if copy_ok {
                (
                    format!("{msg} (copy)"),
                    vec![
                        "-y".into(),
                        "-i".into(),
                        input_str.into(),
                        "-fflags".into(),
                        "+genpts".into(),
                        "-avoid_negative_ts".into(),
                        "make_zero".into(),
                        "-c".into(),
                        "copy".into(),
                        "-movflags".into(),
                        "+faststart".into(),
                        output_str.into(),
                    ],
                )
            } else {
                (
                    format!("{msg} (re-encode)"),
                    ffmpeg_reencode_ae_args(input_str, output_str),
                )
            };

            console_log(
                "EXPORT|clip",
                &format!(
                    "{}/{} input={} output={} mode={}",
                    i + 1,
                    clips.len(),
                    file_name_only(input_str),
                    file_name_only(output_str),
                    if copy_ok { "copy" } else { "re-encode" }
                ),
            );

            let app_for_ffmpeg = app.clone();
            let ffmpeg_clone = ffmpeg.clone();
            let grand_total = total_ms;
            let done_before = done_ms;
            let run_msg = mode_msg.clone();
            let run_args = args;
            let start_time = export_start_time;
            let result = tokio::task::spawn_blocking(move || {
                run_ffmpeg_with_progress(
                    app_for_ffmpeg,
                    ffmpeg_clone,
                    run_args,
                    clip_total,
                    done_before,
                    grand_total,
                    &run_msg,
                    start_time,
                )
            })
            .await
            .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

            if let Err(e) = result {
                // If copy failed, retry re-encode automatically.
                if copy_ok {
                    console_log(
                        "EXPORT|retry",
                        &format!(
                            "clip {}/{} stream copy failed; retry re-encode (input={} output={})",
                            i + 1,
                            clips.len(),
                            file_name_only(input_str),
                            file_name_only(output_str)
                        ),
                    );
                    emit_export_progress(&app, 15, "Stream copy failed; re-encoding...", export_start_time);
                    let app_for_ffmpeg = app.clone();
                    let ffmpeg_clone = ffmpeg.clone();
                    let grand_total = total_ms;
                    let done_before = done_ms;
                    let run_msg = format!("{msg} (re-encode)");
                    let run_args = ffmpeg_reencode_ae_args(input_str, output_str);
                    let start_time = export_start_time;
                    let result2 = tokio::task::spawn_blocking(move || {
                        run_ffmpeg_with_progress(
                            app_for_ffmpeg,
                            ffmpeg_clone,
                            run_args,
                            clip_total,
                            done_before,
                            grand_total,
                            &run_msg,
                            start_time,
                        )
                    })
                    .await
                    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;
                    if let Err(e2) = result2 {
                        console_log(
                            "ERROR|export_clips",
                            &format!(
                                "export failed clip {}/{} input={} output={}",
                                i + 1,
                                clips.len(),
                                file_name_only(input_str),
                                file_name_only(output_str)
                            ),
                        );
                        return Err(format!(
                            "FFmpeg export failed.\n(copy)\n{e}\n\n(re-encode)\n{e2}"
                        ));
                    }
                } else {
                    console_log(
                        "ERROR|export_clips",
                        &format!(
                            "export failed clip {}/{} input={} output={}",
                            i + 1,
                            clips.len(),
                            file_name_only(input_str),
                            file_name_only(output_str)
                        ),
                    );
                    return Err(format!("FFmpeg export failed: {e}"));
                }
            }

            if let Some(ms) = clip_total {
                done_ms = done_ms.saturating_add(ms);
            }
        }

        emit_export_progress(&app, 100, "Export complete", export_start_time);
    }

    console_log("EXPORT|end", "ok");

    Ok(())
}