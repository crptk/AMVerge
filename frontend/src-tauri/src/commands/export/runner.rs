use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::payloads::ProgressPayload;
use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

use super::progress::export_canceled_error;

pub(super) fn register_active_pid(active_pids: &Arc<Mutex<Vec<u32>>>, pid: u32) {
    if let Ok(mut lock) = active_pids.lock() {
        if !lock.contains(&pid) {
            lock.push(pid);
        }
    }
}

pub(super) fn unregister_active_pid(active_pids: &Arc<Mutex<Vec<u32>>>, pid: u32) {
    if let Ok(mut lock) = active_pids.lock() {
        lock.retain(|active| *active != pid);
    }
}

pub(super) fn run_ffmpeg_with_progress(
    app: AppHandle,
    ffmpeg: PathBuf,
    mut args: Vec<String>,
    total_ms: Option<u64>,
    completed_ms: u64,
    grand_total_ms: Option<u64>,
    message_prefix: &str,
    start_time: Instant,
    abort_requested: Arc<std::sync::atomic::AtomicBool>,
    active_pids: Arc<Mutex<Vec<u32>>>,
    emit_progress_updates: bool,
) -> Result<(), String> {
    // Force progress to stderr so we can parse it (while still receiving real errors).
    // Note: ffmpeg writes key=value lines like out_time_ms=..., progress=continue/end.
    args.insert(0, "-hide_banner".into());
    args.insert(0, "-nostats".into());
    args.insert(0, "pipe:2".into());
    args.insert(0, "-progress".into());

    if abort_requested.load(Ordering::SeqCst) {
        return Err(export_canceled_error());
    }

    let mut cmd = Command::new(&ffmpeg);
    apply_no_window(&mut cmd);
    let mut child = cmd
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg ({}): {e}", ffmpeg.display()))?;

    let child_pid = child.id();
    register_active_pid(&active_pids, child_pid);

    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture ffmpeg stderr")?;
    let reader = BufReader::new(stderr);

    let mut stderr_accum = String::new();
    let mut last_emit = Instant::now() - Duration::from_secs(5);
    let mut last_percent: Option<u8> = None;

    for line in reader.lines().flatten() {
        if abort_requested.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            unregister_active_pid(&active_pids, child_pid);
            return Err(export_canceled_error());
        }

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
                let overall_ms =
                    completed_ms.saturating_add(_out_ms.min(total_ms.unwrap_or(_out_ms)));
                let mut percent = if denom_ms > 0 {
                    ((overall_ms as f64 / denom_ms as f64) * 100.0).floor() as i32
                } else {
                    0
                };
                percent = percent.clamp(0, 99);
                let p = percent as u8;

                if emit_progress_updates {
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
        }

        if line_trim == "progress=end" {
            break;
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;

    unregister_active_pid(&active_pids, child_pid);

    if abort_requested.load(Ordering::SeqCst) {
        return Err(export_canceled_error());
    }

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
    if emit_progress_updates {
        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: 80,
                message: format!("{message_prefix}"),
            },
        );
    }

    Ok(())
}
