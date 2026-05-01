use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::payloads::ProgressPayload;
use crate::state::ActiveSidecar;
use crate::utils::logging::{
    console_log, emit_console_log, sanitize_for_console, sanitize_line_with_known_paths,
};
use crate::utils::paths::{
    clear_files_in_dir, dir_name_only, file_name_only, sanitize_episode_cache_id,
};
use crate::utils::process::apply_no_window;

#[tauri::command]
pub async fn detect_scenes(
    app: AppHandle,
    sidecar_state: State<'_, ActiveSidecar>,
    video_path: String,
    episode_cache_id: Option<String>,
    custom_path: Option<String>,
) -> Result<String, String> {
    let video_name = file_name_only(&video_path);

    let base_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    let output_dir = if let Some(raw_id) = episode_cache_id.as_deref() {
        let id = sanitize_episode_cache_id(raw_id)?;
        base_dir.join(id)
    } else {
        base_dir
    };

    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    clear_files_in_dir(&output_dir);
    let output_dir_str = output_dir.to_string_lossy().to_string();

    console_log(
        "SCENE|start",
        &format!(
            "video={video_name} output_dir={}",
            dir_name_only(&output_dir)
        ),
    );

    let output_dir_base = dir_name_only(&output_dir);

    let mut child = if cfg!(debug_assertions) {
        let mut root = std::env::current_dir().map_err(|e| e.to_string())?;
        root.pop();
        root.pop();

        let script_path = root.join("backend").join("app.py");
        let python_path = if cfg!(windows) {
            root.join("backend")
                .join("venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            root.join("backend").join("venv").join("bin").join("python")
        };

        let python_name =
            python_path
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or(if cfg!(windows) {
                    "python.exe"
                } else {
                    "python"
                });
        console_log(
            "SCENE|spawn",
            &format!(
                "mode=dev exe={python_name} script=app.py args=[{video_name},{output_dir_base}]"
            ),
        );

        let mut cmd = Command::new(python_path);
        apply_no_window(&mut cmd);
        cmd.arg(script_path)
            .arg(&video_path)
            .arg(&output_dir_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn python: {e}"))?
    } else {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Can't find current exe: {e}"))?
            .parent()
            .ok_or("Can't get exe directory")?
            .to_path_buf();

        let sidecar_rel = if cfg!(windows) {
            "bin/backend_script-x86_64-pc-windows-msvc/backend_script.exe"
        } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "bin/backend_script-aarch64-apple-darwin/backend_script"
        } else if cfg!(target_os = "macos") {
            "bin/backend_script-x86_64-apple-darwin/backend_script"
        } else {
            return Err("detect_scenes: unsupported platform".to_string());
        };

        let backend = app
            .path()
            .resolve(sidecar_rel, tauri::path::BaseDirectory::Resource)
            .map_err(|e| e.to_string())?;

        let backend_name =
            backend
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or(if cfg!(windows) {
                    "backend_script.exe"
                } else {
                    "backend_script"
                });
        console_log(
            "SCENE|spawn",
            &format!("mode=prod exe={backend_name} args=[{video_name},{output_dir_base}]"),
        );

        let mut cmd = Command::new(backend);
        apply_no_window(&mut cmd);
        cmd.current_dir(&exe_dir)
            .arg(&video_path)
            .arg(&output_dir_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn backend exe: {e}"))?
    };

    let child_pid = child.id();
    console_log("SCENE|pid", &format!("pid={}", child_pid));

    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = Some(child_pid);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stderr_accum = Arc::new(Mutex::new(String::new()));
    let app_for_stderr = app.clone();
    let app_for_stdout = app.clone();
    let stderr_accum_for_thread = Arc::clone(&stderr_accum);

    let stderr_handle = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines().flatten() {
            let sanitized = sanitize_for_console(&line);

            if let Ok(mut acc) = stderr_accum_for_thread.lock() {
                acc.push_str(&line);
                acc.push('\n');
            }

            if let Some(rest) = line.strip_prefix("PROGRESS|") {
                let mut parts = rest.splitn(2, '|');
                let p_str = parts.next().unwrap_or("");
                let msg = parts.next().unwrap_or("").to_string();

                if let Ok(p) = p_str.parse::<u8>() {
                    let _ = app_for_stderr.emit(
                        "scene_progress",
                        ProgressPayload {
                            percent: p,
                            message: msg.clone(),
                        },
                    );

                    emit_console_log(
                        &app_for_stderr,
                        "python",
                        "log",
                        &format!("PROGRESS {p}% - {msg}"),
                    );
                }
            } else {
                emit_console_log(&app_for_stderr, "python", "log", &sanitized);
            }
        }
    });

    let stdout_string = tokio::task::spawn_blocking(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        reader.read_to_string(&mut buf).map(|_| buf)
    })
    .await
    .map_err(|e| format!("stdout thread panicked: {e}"))?
    .map_err(|e| format!("Failed reading stdout: {e}"))?;

    let _ = stderr_handle.await;

    let status = tokio::task::spawn_blocking(move || child.wait())
        .await
        .map_err(|e| format!("wait thread panicked: {e}"))?
        .map_err(|e| format!("Failed waiting for python: {e}"))?;

    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = None;
    }

    console_log(
        "SCENE|end",
        &format!("video={video_name} status={}", status),
    );

    if !status.success() {
        let err = stderr_accum
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| "Python failed (stderr lock poisoned)".to_string());

        console_log(
            "ERROR|detect_scenes",
            &format!("video={video_name} exit={status}"),
        );
        console_log("ERROR|detect_scenes", "backend_stderr_dump_begin");
        for l in err.lines() {
            let sanitized = sanitize_line_with_known_paths(
                l,
                &video_path,
                &video_name,
                &output_dir_str,
                &output_dir_base,
            );
            if !sanitized.trim().is_empty() && !sanitized.starts_with("PROGRESS|") {
                emit_console_log(&app_for_stdout, "python", "log", &sanitized);
            }
        }
        console_log("ERROR|detect_scenes", "backend_stderr_dump_end");
        return Err(err);
    }

    Ok(stdout_string)
}

#[tauri::command]
pub async fn abort_detect_scenes(sidecar_state: State<'_, ActiveSidecar>) -> Result<(), String> {
    let pid = {
        let mut lock = sidecar_state.pid.lock().map_err(|e| e.to_string())?;
        lock.take()
    };

    let Some(pid) = pid else {
        console_log("ABORT", "no active sidecar to kill");
        return Ok(());
    };

    console_log("ABORT", &format!("killing process tree pid={pid}"));

    #[cfg(windows)]
    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("taskkill");
        apply_no_window(&mut cmd);
        cmd.args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {e}"))
    })
    .await
    .map_err(|e| format!("taskkill task panicked: {e}"))??;

    #[cfg(not(windows))]
    let result = tokio::task::spawn_blocking(move || {
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to run kill: {e}"))
    })
    .await
    .map_err(|e| format!("kill task panicked: {e}"))??;

    if result.status.success() {
        console_log("ABORT", &format!("killed pid={pid} ok"));
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        console_log("ABORT", &format!("kill pid={pid} failed: {stderr}"));
    }

    Ok(())
}
