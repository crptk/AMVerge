use std::io::Write;
use std::path::Path;

use crate::utils::logging::{console_log, sanitize_for_console};

use super::encode::{append_audio_encode_args, append_video_encode_args};
use super::probe::ffprobe_duration_ms;
use super::progress::{
    emit_export_progress, export_canceled_error, is_canceled_error_text, is_export_cancel_requested,
};
use super::runner::run_ffmpeg_with_progress;
use super::types::ExportRuntime;

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

    let mut args = vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        filelist_path,
        "-fflags".into(),
        "+genpts".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
    ];

    if runtime.remux_workflow {
        args.extend([
            "-c:v".into(),
            "copy".into(),
            "-c:a".into(),
            "copy".into(),
            "-copyinkf".into(),
        ]);
    } else {
        append_video_encode_args(&mut args, runtime.export_options.as_ref());
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
