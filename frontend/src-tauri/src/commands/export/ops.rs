use std::process::Command;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, State};

use crate::state::ExportAbortState;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::{console_log, sanitize_for_console};
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

pub(super) async fn fast_merge_inner(
    app: AppHandle,
    clips: Vec<String>,
    output_path: String,
) -> Result<String, String> {
    if clips.is_empty() {
        return Err("No clips to merge".into());
    }

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;

    let mut cmd = Command::new(&ffmpeg);
    apply_no_window(&mut cmd);

    let mut filter_input = String::new();
    let mut args = vec!["-y".to_string()];

    for (index, clip) in clips.iter().enumerate() {
        args.push("-i".to_string());
        args.push(clip.clone());
        filter_input.push_str(&format!("[{index}:v][{index}:a]"));
    }

    let filter_complex = format!(
        "{}concat=n={}:v=1:a=1[v_raw][a];[v_raw]format=yuv420p[v]",
        filter_input,
        clips.len()
    );

    args.extend([
        "-filter_complex".to_string(),
        filter_complex,
        "-map".to_string(),
        "[v]".to_string(),
        "-map".to_string(),
        "[a]".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-crf".to_string(),
        "17".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.clone(),
    ]);

    let result = cmd
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("FFmpeg merge failed: {stderr}"));
    }

    Ok(output_path)
}

pub(super) async fn fast_split_inner(
    app: AppHandle,
    input_path: String,
    split_time: f64,
    output_path1: String,
    output_path2: String,
    thumb_path2: String,
) -> Result<(), String> {
    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;

    console_log(
        "SPLIT",
        &format!(
            "input={} split_at={:.2}s",
            file_name_only(&input_path),
            split_time
        ),
    );

    let mut cmd1 = Command::new(&ffmpeg);
    apply_no_window(&mut cmd1);
    let out1 = cmd1
        .args([
            "-y",
            "-i",
            &input_path,
            "-t",
            &split_time.to_string(),
            "-c:v",
            "libx264",
            "-crf",
            "17",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-avoid_negative_ts",
            "make_zero",
            &output_path1,
        ])
        .output()
        .map_err(|e| format!("Part 1 failed: {e}"))?;

    if !out1.status.success() {
        return Err(format!(
            "FFmpeg Part 1 failed: {}",
            String::from_utf8_lossy(&out1.stderr)
        ));
    }

    let mut cmd2 = Command::new(&ffmpeg);
    apply_no_window(&mut cmd2);
    let out2 = cmd2
        .args([
            "-y",
            "-ss",
            &split_time.to_string(),
            "-i",
            &input_path,
            "-c:v",
            "libx264",
            "-crf",
            "17",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-avoid_negative_ts",
            "make_zero",
            &output_path2,
        ])
        .output()
        .map_err(|e| format!("Part 2 failed: {e}"))?;

    if !out2.status.success() {
        return Err(format!(
            "FFmpeg Part 2 failed: {}",
            String::from_utf8_lossy(&out2.stderr)
        ));
    }

    let mut cmd3 = Command::new(&ffmpeg);
    apply_no_window(&mut cmd3);
    let _ = cmd3
        .args([
            "-y",
            "-ss",
            &split_time.to_string(),
            "-i",
            &input_path,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            "-s",
            "360x202",
            &thumb_path2,
        ])
        .output();

    Ok(())
}

pub(super) async fn abort_export_inner(
    abort_state: State<'_, ExportAbortState>,
) -> Result<String, String> {
    abort_state.abort_requested.store(true, Ordering::SeqCst);

    let pids = {
        let lock = abort_state.pids.lock().map_err(|e| e.to_string())?;
        lock.clone()
    };

    if pids.is_empty() {
        return Ok("Export cancellation requested.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let result = tokio::task::spawn_blocking(move || {
            for pid in pids {
                let mut cmd = Command::new("taskkill");
                apply_no_window(&mut cmd);
                let out = cmd.args(["/F", "/T", "/PID", &pid.to_string()]).output();
                if let Ok(ref output) = out {
                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                        console_log(
                            "EXPORT|abort",
                            &format!(
                                "taskkill pid={} failed: {}",
                                pid,
                                sanitize_for_console(&stderr)
                            ),
                        );
                    }
                }
            }
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| format!("taskkill task panicked: {e}"))?
        .map_err(|e| format!("Failed to run taskkill: {e}"))?;

        let _ = result;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = tokio::task::spawn_blocking(move || {
            for pid in pids {
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output();
            }
        })
        .await;
    }

    if let Ok(mut lock) = abort_state.pids.lock() {
        lock.clear();
    }

    Ok("Export cancellation requested.".to_string())
}
