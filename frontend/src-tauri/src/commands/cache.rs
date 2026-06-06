use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::utils::paths::sanitize_episode_cache_id;

fn is_uuid_cache_dir_name(name: &str) -> bool {
    if name.len() != 36 {
        return false;
    }

    for (idx, ch) in name.chars().enumerate() {
        let is_hyphen_slot = matches!(idx, 8 | 13 | 18 | 23);
        if is_hyphen_slot {
            if ch != '-' {
                return false;
            }
            continue;
        }

        if !ch.is_ascii_hexdigit() {
            return false;
        }
    }

    true
}

fn trash_path(path: &std::path::Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| format!("Failed to move item to trash: {e}"))
}

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
        trash_path(&episode_dir)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn clear_episode_panel_cache(
    app: AppHandle,
    custom_path: Option<String>,
) -> Result<(), String> {
    let using_custom_path = custom_path.is_some();
    let episodes_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    if !episodes_dir.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(&episodes_dir)
        .map_err(|e| format!("Failed to read cache directory: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read cache entry: {e}"))?;
        let path = entry.path();

        if using_custom_path {
            if !path.is_dir() {
                continue;
            }

            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !is_uuid_cache_dir_name(&name) {
                continue;
            }
        }

        trash_path(&path)?;
    }

    Ok(())
}
