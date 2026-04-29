use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::state::DiscordRPCState;
use crate::utils::process::apply_no_window;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn start_discord_rpc(
    _app: AppHandle,
    state: State<'_, DiscordRPCState>,
) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    if child_guard.is_some() {
        return Ok(());
    }

    let current_dir = std::env::current_dir().unwrap_or_default();

    // Detect project root (handle both root and src-tauri dirs)
    let project_root = if current_dir.ends_with("src-tauri") {
        current_dir
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or(current_dir)
    } else {
        current_dir
    };

    println!("[Discord RPC] Project root: {:?}", project_root);

    // Determine python path
    let python_path = if cfg!(windows) {
        project_root
            .join("backend")
            .join("venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        Path::new("python3").to_path_buf()
    };

    let python_cmd = if python_path.exists() {
        python_path.to_string_lossy().to_string()
    } else {
        "python".to_string()
    };

    let script_path = project_root
        .join("backend")
        .join("discordrpc")
        .join("rpc_server.py");

    println!("[Discord RPC] Using python: {}", python_cmd);
    println!("[Discord RPC] Using script: {:?}", script_path);

    if !script_path.exists() {
        return Err(format!("Discord RPC script not found at {:?}", script_path));
    }

    let mut cmd = Command::new(python_cmd);
    apply_no_window(&mut cmd);
    let child = cmd
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit()) // Show errors in console
        .spawn()
        .map_err(|e| format!("Failed to spawn Discord RPC: {e}"))?;

    println!("[Discord RPC] Process started successfully");
    *child_guard = Some(child);
    Ok(())
}

#[tauri::command]
pub async fn update_discord_rpc(
    state: State<'_, DiscordRPCState>,
    data: serde_json::Value,
) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(child) = child_guard.as_mut() {
        if let Some(stdin) = child.stdin.as_mut() {
            let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
            if let Err(e) = writeln!(stdin, "{}", json) {
                return Err(format!("Failed to write to RPC stdin: {e}"));
            }
            if let Err(e) = stdin.flush() {
                return Err(format!("Failed to flush RPC stdin: {e}"));
            }
            return Ok(());
        }
    }
    Err("Discord RPC not running".to_string())
}

#[tauri::command]
pub async fn stop_discord_rpc(state: State<'_, DiscordRPCState>) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(mut child) = child_guard.take() {
        // Try to send a graceful shutdown command first
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = writeln!(stdin, "{{\"type\": \"shutdown\"}}");
            let _ = stdin.flush();
        }

        // Give it a tiny bit of time to clear the presence and exit
        let mut count = 0;
        while count < 5 {
            match child.try_wait() {
                Ok(Some(_)) => return Ok(()), // Exited gracefully
                _ => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    count += 1;
                }
            }
        }

        // If it's still alive, kill it forcefully
        let _ = child.kill();
        println!("[Discord RPC] Forcefully killed ghost process");
    }
    Ok(())
}
