#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod payloads;
mod state;
mod utils;

use tauri::Manager;
use state::{ActiveSidecar, PreviewProxyLocks, DiscordRPCState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PreviewProxyLocks::default())
        .manage(ActiveSidecar::default())
        .manage(DiscordRPCState::default())
        .invoke_handler(tauri::generate_handler![
            commands::scenes::detect_scenes,
            commands::scenes::abort_detect_scenes,
            commands::export::export_clips,
            commands::preview::check_hevc,
            commands::preview::hover_preview_error,
            commands::preview::ensure_preview_proxy,
            commands::cache::delete_episode_cache,
            commands::cache::clear_episode_panel_cache,
            commands::settings::save_background_image,
            commands::settings::crop_and_save_image,
            commands::settings::move_episodes_to_new_dir,
            commands::settings::get_default_episodes_dir,
            commands::discord::start_discord_rpc,
            commands::discord::update_discord_rpc,
            commands::discord::stop_discord_rpc,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<DiscordRPCState>();
                let mut child_guard = state.child.lock().unwrap();
                if let Some(mut child) = child_guard.take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running app");
}