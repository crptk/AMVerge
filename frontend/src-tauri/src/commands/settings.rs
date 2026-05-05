use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn get_default_episodes_dir(app: AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("episodes");

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn move_episodes_to_new_dir(
    app: AppHandle,
    old_dir: Option<String>,
    new_dir: Option<String>,
) -> Result<String, String> {
    let old_path = match old_dir {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes"),
    };

    let new_path = match new_dir {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes"),
    };
    let old_path_string = old_path.to_string_lossy().to_string();

    if old_path == new_path {
        return Ok(old_path_string);
    }

    if !old_path.exists() {
        return Ok(old_path_string);
    }

    fs::create_dir_all(&new_path).map_err(|e| format!("Failed to create new directory: {e}"))?;

    for entry in
        fs::read_dir(&old_path).map_err(|e| format!("Failed to read old directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;

        let src = entry.path();
        let dest = new_path.join(entry.file_name());

        fs::rename(&src, &dest).or_else(|_| {
            if src.is_dir() {
                let mut options = fs_extra::dir::CopyOptions::new();
                options.copy_inside = true;

                fs::create_dir_all(&dest)
                    .map_err(|e| format!("Failed to create destination folder: {e}"))?;

                fs_extra::dir::copy(&src, &dest, &options)
                    .map_err(|e| format!("Failed to copy directory: {e}"))?;

                fs::remove_dir_all(&src)
                    .map_err(|e| format!("Failed to remove old directory: {e}"))?;
            } else {
                fs::copy(&src, &dest).map_err(|e| format!("Failed to copy file: {e}"))?;

                fs::remove_file(&src).map_err(|e| format!("Failed to remove old file: {e}"))?;
            }

            Ok::<(), String>(())
        })?;
    }

    Ok(old_path_string)
}

#[tauri::command]
pub fn save_background_image(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    let source = Path::new(&source_path);

    if !source.exists() {
        return Err("Selected image does not exist.".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    let backgrounds_dir = app_data_dir.join("backgrounds");

    fs::create_dir_all(&backgrounds_dir)
        .map_err(|e| format!("Failed to create backgrounds directory: {e}"))?;

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png");

    let file_name = format!("background.{}", extension);
    let destination = backgrounds_dir.join(file_name);

    fs::copy(source, &destination).map_err(|e| format!("Failed to copy background image: {e}"))?;

    Ok(destination.to_string_lossy().to_string())
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct CropData {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: i32,
    pub flip_h: bool,
    pub flip_v: bool,
}

fn is_no_transform(crop: &CropData) -> bool {
    crop.x == 0.0 && crop.y == 0.0 && crop.rotation == 0 && !crop.flip_h && !crop.flip_v
}

fn sanitize_icon_id(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.is_empty() {
        "profile".to_string()
    } else {
        sanitized
    }
}

fn run_python_crop(
    source_path: &str,
    destination: &Path,
    crop: &CropData,
) -> Result<String, String> {
    let crop_json = serde_json::to_string(crop).map_err(|e| e.to_string())?;
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

    // Find python path (prefer venv)
    let python_path = if cfg!(windows) {
        project_root
            .join("backend")
            .join("venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        Path::new("python3").to_path_buf()
    };

    // Fallback to "python" if venv not found
    let python_cmd = if python_path.exists() {
        python_path.to_string_lossy().to_string()
    } else {
        "python".to_string()
    };

    let script_path = project_root
        .join("backend")
        .join("utils")
        .join("image_processor.py");

    let output = std::process::Command::new(python_cmd)
        .arg(script_path)
        .arg(source_path)
        .arg(destination)
        .arg(crop_json)
        .output()
        .map_err(|e| format!("Failed to execute python: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {err}"));
    }

    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn crop_and_save_image(
    app: tauri::AppHandle,
    source_path: String,
    crop: CropData,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    let backgrounds_dir = app_data_dir.join("backgrounds");
    fs::create_dir_all(&backgrounds_dir)
        .map_err(|e| format!("Failed to create backgrounds directory: {e}"))?;

    let ext = Path::new(&source_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let destination = if ext == "gif" {
        backgrounds_dir.join("background.gif")
    } else {
        backgrounds_dir.join("background.jpg")
    };

    let source_path_for_worker = source_path.clone();
    tokio::task::spawn_blocking(move || {
        let source_ext = Path::new(&source_path_for_worker)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let destination_ext = destination
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let can_direct_copy = is_no_transform(&crop) && source_ext == destination_ext;

        if can_direct_copy {
            fs::copy(&source_path_for_worker, &destination).map_err(|e| e.to_string())?;
            return Ok::<String, String>(destination.to_string_lossy().to_string());
        }

        run_python_crop(&source_path_for_worker, &destination, &crop)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crop_and_save_profile_icon(
    app: tauri::AppHandle,
    source_path: String,
    icon_id: String,
    crop: CropData,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    let icons_dir = app_data_dir.join("profile_icons");
    fs::create_dir_all(&icons_dir)
        .map_err(|e| format!("Failed to create profile icons directory: {e}"))?;

    let ext = Path::new(&source_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let safe_icon_id = sanitize_icon_id(&icon_id);
    let destination = if ext == "gif" {
        icons_dir.join(format!("{safe_icon_id}.gif"))
    } else {
        icons_dir.join(format!("{safe_icon_id}.png"))
    };

    let source_path_for_worker = source_path.clone();
    tokio::task::spawn_blocking(move || {
        let source_ext = Path::new(&source_path_for_worker)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let destination_ext = destination
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let can_direct_copy = is_no_transform(&crop) && source_ext == destination_ext;

        if can_direct_copy {
            fs::copy(&source_path_for_worker, &destination).map_err(|e| e.to_string())?;
            return Ok::<String, String>(destination.to_string_lossy().to_string());
        }

        run_python_crop(&source_path_for_worker, &destination, &crop)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn delete_profile_icon_file(app: tauri::AppHandle, icon_path: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    let icons_dir = app_data_dir.join("profile_icons");

    let requested_path = PathBuf::from(icon_path);
    if !requested_path.exists() {
        return Ok(());
    }

    let canonical_icons_dir = fs::canonicalize(&icons_dir).unwrap_or(icons_dir);
    let canonical_requested_path = fs::canonicalize(&requested_path)
        .map_err(|e| format!("Failed to resolve icon path: {e}"))?;

    if !canonical_requested_path.starts_with(&canonical_icons_dir) {
        return Err("Refusing to delete icon outside profile_icons directory.".to_string());
    }

    fs::remove_file(&canonical_requested_path)
        .map_err(|e| format!("Failed to delete profile icon file: {e}"))?;

    Ok(())
}
