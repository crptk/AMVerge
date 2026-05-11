#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod payloads;
mod state;
mod utils;

use state::{
    ActiveFfmpegPids, ActiveSidecar, DiscordRPCState, EditorImportAbortState, ExportAbortState,
    PreviewProxyLocks,
};
use std::process::Command as StdCommand;
use std::sync::atomic::Ordering;
use tauri::Manager;

fn main() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PreviewProxyLocks::default())
        .manage(ActiveSidecar::default())
        .manage(DiscordRPCState::default())
        .manage(EditorImportAbortState::default())
        .manage(ExportAbortState::default())
        .manage(ActiveFfmpegPids::default())
        .invoke_handler(tauri::generate_handler![
            commands::bug_report::submit_bug_report,
            commands::notifications::fetch_startup_notification,
            commands::scenes::detect_scenes,
            commands::scenes::abort_detect_scenes,
            commands::export::export_clips,
            commands::export::abort_export,
            commands::export::detect_nvidia_encoder_profile,
            commands::export::detect_gpu_encoder_capabilities,
            commands::export::fast_merge,
            commands::export::fast_split,
            commands::editor_import::import_media_to_editor,
            commands::editor_import::abort_editor_import,
            commands::filmstrip::generate_filmstrip,
            commands::preview::check_hevc,
            commands::preview::hover_preview_error,
            commands::preview::ensure_preview_proxy,
            commands::preview::ensure_merged_preview,
            commands::cache::delete_episode_cache,
            commands::cache::clear_episode_panel_cache,
            commands::settings::save_background_image,
            commands::settings::crop_and_save_image,
            commands::settings::crop_and_save_profile_icon,
            commands::settings::delete_profile_icon_file,
            commands::settings::reveal_in_file_manager,
            commands::settings::move_episodes_to_new_dir,
            commands::settings::get_default_episodes_dir,
            commands::discord::start_discord_rpc,
            commands::discord::update_discord_rpc,
            commands::discord::stop_discord_rpc,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                kill_all_child_processes(&window.app_handle().clone());
            }
        })
        .build(tauri::generate_context!())
        .expect("error building app")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_all_child_processes(app);
            }
        });
}

fn kill_all_child_processes(app: &tauri::AppHandle) {
    // Kill active export ffmpeg processes.
    let export_state = app.state::<ExportAbortState>();
    export_state.abort_requested.store(true, Ordering::SeqCst);
    let export_pids: Vec<u32> = export_state
        .pids
        .lock()
        .map(|mut l| l.drain(..).collect())
        .unwrap_or_default();
    for pid in export_pids {
        #[cfg(not(target_os = "windows"))]
        let _ = StdCommand::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output();
        #[cfg(target_os = "windows")]
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    // Kill untracked ffmpeg processes (merge, split, proxy, filmstrip).
    let misc_pids: Vec<u32> = app
        .state::<ActiveFfmpegPids>()
        .pids
        .lock()
        .map(|mut l| l.drain(..).collect())
        .unwrap_or_default();
    for pid in misc_pids {
        #[cfg(not(target_os = "windows"))]
        let _ = StdCommand::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output();
        #[cfg(target_os = "windows")]
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    // Kill Python sidecar (scene detection) process group.
    let sidecar = app.state::<ActiveSidecar>();
    if let Ok(mut lock) = sidecar.child.lock() {
        *lock = None;
    }
    let sidecar_pid = sidecar.pid.lock().ok().and_then(|mut l| l.take());
    if let Some(pid) = sidecar_pid {
        #[cfg(not(target_os = "windows"))]
        let _ = StdCommand::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output();
        #[cfg(target_os = "windows")]
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    // Gracefully shut down Discord RPC.
    let discord_child = app
        .state::<DiscordRPCState>()
        .child
        .lock()
        .ok()
        .and_then(|mut g| g.take());
    if let Some(mut child) = discord_child {
        use std::io::Write;
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = writeln!(stdin, "{{\"type\": \"shutdown\"}}");
            let _ = stdin.flush();
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = child.kill();
    }
}
