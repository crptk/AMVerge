use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::utils::paths::sanitize_episode_cache_id;
use crate::commands::frame_cache::clear_all_frame_caches;

#[tauri::command]
pub async fn delete_episode_cache(
    app: AppHandle,
    episode_cache_id: String,
    custom_path: Option<String>,
) -> Result<(), String> {
    let id = sanitize_episode_cache_id(&episode_cache_id)?;
    let base_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    let episode_dir = base_dir.join(id);
    if episode_dir.exists() {
        std::fs::remove_dir_all(&episode_dir).map_err(|e| e.to_string())?;
    }

    // Also clear ANY frame caches (global for now as they are identified by clip ID)
    // Or we could be more specific, but clip IDs are unique across episodes usually.
    let _ = clear_all_frame_caches(app).await;

    Ok(())
}

#[tauri::command]
pub async fn clear_episode_panel_cache(app: AppHandle, custom_path: Option<String>) -> Result<(), String> {
    let episodes_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    if episodes_dir.exists() {
        std::fs::remove_dir_all(&episodes_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
