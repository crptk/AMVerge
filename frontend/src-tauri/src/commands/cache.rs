use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use crate::utils::paths::sanitize_episode_cache_id;

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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntry {
    pub id: String,
    pub src: String,
    pub thumbnail: String,
    pub original_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeEntry {
    pub id: String,
    pub display_name: String,
    pub video_path: Option<String>,
    pub folder_id: Option<String>,
    pub imported_at: Option<i64>,
    pub clips: Vec<ClipEntry>,
}

fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp4" | "mov" | "mkv" | "webm"
            )
        })
        .unwrap_or(false)
}

fn thumbnail_for_video(path: &Path) -> String {
    let mut thumb = path.to_path_buf();
    thumb.set_extension("jpg");

    if thumb.exists() {
        return thumb.to_string_lossy().to_string();
    }

    let mut png_thumb = path.to_path_buf();
    png_thumb.set_extension("png");

    if png_thumb.exists() {
        return png_thumb.to_string_lossy().to_string();
    }

    String::new()
}

#[tauri::command]
pub async fn write_episode_metadata(
    app: AppHandle,
    custom_path: Option<String>,
    episode: EpisodeEntry,
) -> Result<(), String> {
    let id = sanitize_episode_cache_id(&episode.id)?;

    let episodes_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    let episode_dir = episodes_dir.join(id);
    std::fs::create_dir_all(&episode_dir).map_err(|e| e.to_string())?;

    let metadata_path = episode_dir.join("metadata.json");
    let raw = serde_json::to_string_pretty(&episode).map_err(|e| e.to_string())?;

    std::fs::write(metadata_path, raw).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn scan_episode_panel_cache(
    app: AppHandle,
    custom_path: Option<String>,
) -> Result<Vec<EpisodeEntry>, String> {
    let episodes_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    if !episodes_dir.exists() {
        return Ok(Vec::new());
    }

    let mut episodes: Vec<EpisodeEntry> = Vec::new();

    let entries = std::fs::read_dir(&episodes_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let episode_dir = entry.path();

        if !episode_dir.is_dir() {
            continue;
        }

        let episode_id = entry.file_name().to_string_lossy().to_string();

        // Avoid weird paths or manually-created invalid folder names.
        let episode_id = match sanitize_episode_cache_id(&episode_id) {
            Ok(id) => id,
            Err(_) => continue,
        };

        let metadata_path = episode_dir.join("metadata.json");

        if metadata_path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&metadata_path) {
                if let Ok(mut episode) = serde_json::from_str::<EpisodeEntry>(&raw) {
                    episode.id = episode_id.clone();
                    episodes.push(episode);
                    continue;
                }
            }
        }
        let mut clips: Vec<ClipEntry> = Vec::new();

        let clip_entries = match std::fs::read_dir(&episode_dir) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for clip_entry in clip_entries {
            let clip_entry = match clip_entry {
                Ok(v) => v,
                Err(_) => continue,
            };

            let clip_path = clip_entry.path();

            if !clip_path.is_file() || !is_video_file(&clip_path) {
                continue;
            }

            let clip_stem = clip_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("clip")
                .to_string();

            clips.push(ClipEntry {
                id: format!("{}:{}", episode_id, clip_stem),
                src: clip_path.to_string_lossy().to_string(),
                thumbnail: thumbnail_for_video(&clip_path),
                original_name: clip_stem,
            });
        }

        clips.sort_by(|a, b| a.src.cmp(&b.src));

        let display_name = clips
            .first()
            .map(|clip| clip.original_name.clone())
            .unwrap_or_else(|| episode_id.clone());

        episodes.push(EpisodeEntry {
            id: episode_id.clone(),
            display_name,
            video_path: None,
            folder_id: None,
            imported_at: None,
            clips,
        });
    }

    episodes.sort_by(|a, b| a.display_name.cmp(&b.display_name));

    Ok(episodes)
}