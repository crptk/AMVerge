use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
use tauri::Emitter;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct ProgressPayload {
    percent: u8,
    message: String,
}

#[tauri::command]
async fn detect_scenes(
    app: AppHandle,
    video_path: String,
) -> Result<String, String> {
    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| e.to_string())?;

    if let Ok(entries) = std::fs::read_dir(&output_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let output_dir_str = output_dir.to_string_lossy().to_string();

    let mut root = std::env::current_dir().map_err(|e| e.to_string())?;
    root.pop();
    root.pop();

    let script_path = root.join("backend").join("backend_script.py");
    let python_path = root
        .join("backend")
        .join("venv")
        .join("Scripts")
        .join("python.exe");

    let mut child = Command::new(python_path)
        .arg(script_path)
        .arg(&video_path)
        .arg(&output_dir_str)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn python: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stderr_accum = Arc::new(Mutex::new(String::new()));
    let app_for_thread = app.clone();
    let stderr_accum_for_thread = Arc::clone(&stderr_accum);

    let stderr_handle = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut buf) = stderr_accum_for_thread.lock() {
                buf.push_str(&line);
                buf.push('\n');
            }

            if let Some(rest) = line.strip_prefix("PROGRESS|") {
                let mut parts = rest.splitn(2, '|');
                let p_str = parts.next().unwrap_or("");
                let msg = parts.next().unwrap_or("").to_string();

                if let Ok(p) = p_str.parse::<u8>() {
                    let _ = app_for_thread.emit(
                        "scene_progress",
                        ProgressPayload { percent: p, message: msg },
                    );
                }
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

    if !status.success() {
        let err = stderr_accum
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| "Python failed (stderr lock poisoned)".to_string());
        return Err(err);
    }

    Ok(stdout_string)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![detect_scenes])
        .run(tauri::generate_context!())
        .expect("error running app");
}