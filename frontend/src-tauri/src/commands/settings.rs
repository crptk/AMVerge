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

    fs::create_dir_all(&new_path)
        .map_err(|e| format!("Failed to create new directory: {e}"))?;

    for entry in fs::read_dir(&old_path)
        .map_err(|e| format!("Failed to read old directory: {e}"))?
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
                fs::copy(&src, &dest)
                    .map_err(|e| format!("Failed to copy file: {e}"))?;

                fs::remove_file(&src)
                    .map_err(|e| format!("Failed to remove old file: {e}"))?;
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

    fs::copy(source, &destination)
        .map_err(|e| format!("Failed to copy background image: {e}"))?;

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

#[tauri::command]
pub async fn crop_and_save_image(
    app: tauri::AppHandle,
    source_path: String,
    crop: CropData,
) -> Result<String, String> {
    use std::path::Path;

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

    // Fast-path: If no transformation is needed, just copy the file
    let is_no_op = crop.x == 0.0 && crop.y == 0.0 && 
                  crop.rotation == 0 && !crop.flip_h && !crop.flip_v;

    // We can only skip if the width/height also match, but we need the image size first
    
    // Offload to Python for better GIF handling
    tokio::task::spawn_blocking(move || {
        if is_no_op {
            fs::copy(&source_path, &destination).map_err(|e| e.to_string())?;
            return Ok::<String, String>(destination.to_string_lossy().to_string());
        }

        let crop_json = serde_json::to_string(&crop).map_err(|e| e.to_string())?;
        
        let home_dir = app.path().home_dir().map_err(|e| e.to_string())?;
        
        // Find python path (prefer venv)
        let python_path = if cfg!(windows) {
            home_dir.join("Documents").join("GitHub").join("AMVergeNew").join("backend").join("venv").join("Scripts").join("python.exe")
        } else {
            Path::new("python3").to_path_buf()
        };

        // Fallback to "python" if venv not found
        let python_cmd = if python_path.exists() {
            python_path.to_string_lossy().to_string()
        } else {
            "python".to_string()
        };

        let script_path = home_dir.join("Documents").join("GitHub").join("AMVergeNew").join("backend").join("utils").join("image_processor.py");

        let output = std::process::Command::new(python_cmd)
            .arg(script_path)
            .arg(&source_path)
            .arg(&destination)
            .arg(crop_json)
            .output()
            .map_err(|e| format!("Failed to execute python: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Python error: {}", err));
        }

        Ok::<String, String>(destination.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
