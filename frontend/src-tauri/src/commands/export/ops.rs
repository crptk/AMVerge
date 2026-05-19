use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

#[cfg(not(windows))]
use std::os::unix::process::CommandExt;

use tauri::{AppHandle, State};

use crate::state::ExportAbortState;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
#[cfg(target_os = "windows")]
use crate::utils::logging::sanitize_for_console;
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

pub(super) async fn fast_merge_inner(
    app: AppHandle,
    active_pids: Arc<Mutex<Vec<u32>>>,
    clips: Vec<String>,
    output_path: String,
) -> Result<String, String> {
    if clips.is_empty() {
        return Err("No clips to merge".into());
    }

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;

    let mut cmd = Command::new(&ffmpeg);
    apply_no_window(&mut cmd);

    let mut filter_parts: Vec<String> = Vec::with_capacity(clips.len() * 2);
    let mut concat_inputs = String::new();
    let mut args = vec!["-y".to_string()];

    for (index, clip) in clips.iter().enumerate() {
        args.push("-i".to_string());
        args.push(clip.clone());
        filter_parts.push(format!("[{index}:v:0]setpts=PTS-STARTPTS,format=yuv420p[v{index}]"));
        filter_parts.push(format!("[{index}:a:0]asetpts=PTS-STARTPTS[a{index}]"));
        concat_inputs.push_str(&format!("[v{index}][a{index}]"));
    }

    let filter_complex = format!(
        "{};{}concat=n={}:v=1:a=1[v][a]",
        filter_parts.join(";"),
        concat_inputs,
        clips.len()
    );

    args.extend([
        "-filter_complex".to_string(),
        filter_complex,
        "-map".to_string(),
        "[v]".to_string(),
        "-map".to_string(),
        "[a]".to_string(),
        "-fps_mode".to_string(),
        "passthrough".to_string(),
        "-enc_time_base:v".to_string(),
        "demux".to_string(),
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

    #[cfg(not(windows))]
    cmd.process_group(0);
    let child = cmd
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;
    let pid = child.id();
    if let Ok(mut l) = active_pids.lock() {
        l.push(pid);
    }
    let result = child
        .wait_with_output()
        .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;
    if let Ok(mut l) = active_pids.lock() {
        l.retain(|p| *p != pid);
    }

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("FFmpeg merge failed: {stderr}"));
    }

    Ok(output_path)
}

pub(super) async fn fast_split_inner(
    app: AppHandle,
    active_pids: Arc<Mutex<Vec<u32>>>,
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
    #[cfg(not(windows))]
    cmd1.process_group(0);
    let child1 = cmd1
        .args([
            "-y",
            "-i",
            &input_path,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-t",
            &split_time.to_string(),
            "-vf",
            "setpts=PTS-STARTPTS",
            "-af",
            "asetpts=PTS-STARTPTS",
            "-fps_mode",
            "passthrough",
            "-enc_time_base:v",
            "demux",
            "-c:v",
            "libx264",
            "-crf",
            "17",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            &output_path1,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Part 1 failed: {e}"))?;
    let pid1 = child1.id();
    if let Ok(mut l) = active_pids.lock() { l.push(pid1); }
    let out1 = child1.wait_with_output().map_err(|e| format!("Part 1 failed: {e}"))?;
    if let Ok(mut l) = active_pids.lock() { l.retain(|p| *p != pid1); }

    if !out1.status.success() {
        return Err(format!(
            "FFmpeg Part 1 failed: {}",
            String::from_utf8_lossy(&out1.stderr)
        ));
    }

    let mut cmd2 = Command::new(&ffmpeg);
    apply_no_window(&mut cmd2);
    #[cfg(not(windows))]
    cmd2.process_group(0);
    let child2 = cmd2
        .args([
            "-y",
            "-i",
            &input_path,
            "-ss",
            &split_time.to_string(),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-vf",
            "setpts=PTS-STARTPTS",
            "-af",
            "asetpts=PTS-STARTPTS",
            "-fps_mode",
            "passthrough",
            "-enc_time_base:v",
            "demux",
            "-c:v",
            "libx264",
            "-crf",
            "17",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            &output_path2,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Part 2 failed: {e}"))?;
    let pid2 = child2.id();
    if let Ok(mut l) = active_pids.lock() { l.push(pid2); }
    let out2 = child2.wait_with_output().map_err(|e| format!("Part 2 failed: {e}"))?;
    if let Ok(mut l) = active_pids.lock() { l.retain(|p| *p != pid2); }

    if !out2.status.success() {
        return Err(format!(
            "FFmpeg Part 2 failed: {}",
            String::from_utf8_lossy(&out2.stderr)
        ));
    }

    let mut cmd3 = Command::new(&ffmpeg);
    apply_no_window(&mut cmd3);
    #[cfg(not(windows))]
    cmd3.process_group(0);
    if let Ok(mut child3) = cmd3
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
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let pid3 = child3.id();
        if let Ok(mut l) = active_pids.lock() { l.push(pid3); }
        let _ = child3.wait();
        if let Ok(mut l) = active_pids.lock() { l.retain(|p| *p != pid3); }
    }

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
                // Negative PID kills the entire process group (ffmpeg + any children).
                let _ = Command::new("kill")
                    .args(["-9", &format!("-{pid}")])
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
