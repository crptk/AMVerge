use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use image::DynamicImage;
use tauri::{AppHandle, Manager};

use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::process::apply_no_window;

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
    let using_custom_old = old_dir
        .as_deref()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);

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

    if !old_path.exists() {
        return Ok(old_path_string);
    }

    fs::create_dir_all(&new_path).map_err(|e| format!("Failed to create new directory: {e}"))?;

    let old_canonical = fs::canonicalize(&old_path)
        .map_err(|e| format!("Failed to resolve current episodes directory: {e}"))?;
    let new_canonical = fs::canonicalize(&new_path)
        .map_err(|e| format!("Failed to resolve target episodes directory: {e}"))?;

    if old_canonical == new_canonical {
        return Ok(old_path_string);
    }

    for entry in
        fs::read_dir(&old_path).map_err(|e| format!("Failed to read old directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;

        let src = entry.path();
        if src == new_canonical {
            continue;
        }

        if using_custom_old {
            if !src.is_dir() {
                continue;
            }

            let name = entry.file_name();
            let name = name.to_string_lossy();
            let is_supported_cache_dir = is_uuid_cache_dir_name(&name) || name.eq_ignore_ascii_case("episodes");
            if !is_supported_cache_dir {
                continue;
            }
        }

        let dest = new_path.join(entry.file_name());

        fs::rename(&src, &dest).or_else(|_| {
            if src.is_dir() {
                let mut options = fs_extra::dir::CopyOptions::new();
                options.copy_inside = true;
                options.overwrite = true;

                fs::create_dir_all(&dest)
                    .map_err(|e| format!("Failed to create destination folder: {e}"))?;

                fs_extra::dir::copy(&src, &dest, &options)
                    .map_err(|e| format!("Failed to copy directory: {e}"))?;

                fs::remove_dir_all(&src)
                    .map_err(|e| format!("Failed to remove old directory: {e}"))?;
            } else {
                if dest.exists() {
                    if dest.is_file() {
                        fs::remove_file(&dest)
                            .map_err(|e| format!("Failed to replace existing file: {e}"))?;
                    } else {
                        return Err(
                            "Failed to copy file: destination exists as a directory.".to_string(),
                        );
                    }
                }

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

fn is_video_extension(ext: &str) -> bool {
    matches!(
        ext,
        "mp4" | "webm" | "mov" | "mkv" | "avi" | "m4v"
    )
}

fn build_ffmpeg_filter(crop: &CropData) -> String {
    let mut steps: Vec<String> = Vec::new();

    match crop.rotation.rem_euclid(360) {
        90 => steps.push("transpose=1".to_string()),
        180 => {
            steps.push("transpose=1".to_string());
            steps.push("transpose=1".to_string());
        }
        270 => steps.push("transpose=2".to_string()),
        _ => {}
    }

    if crop.flip_h {
        steps.push("hflip".to_string());
    }

    if crop.flip_v {
        steps.push("vflip".to_string());
    }

    let x = crop.x.round().max(0.0) as i64;
    let y = crop.y.round().max(0.0) as i64;
    let w = crop.width.round().max(1.0) as i64;
    let h = crop.height.round().max(1.0) as i64;
    steps.push(format!("crop={w}:{h}:{x}:{y}"));

    steps.join(",")
}

fn run_ffmpeg_transform(
    app: &AppHandle,
    source_path: &str,
    destination: &Path,
    crop: &CropData,
    preserve_gif_animation: bool,
) -> Result<String, String> {
    let ffmpeg = resolve_bundled_tool(app, "ffmpeg")?;
    let mut cmd = Command::new(&ffmpeg);
    apply_no_window(&mut cmd);

    let base_filter = build_ffmpeg_filter(crop);

    cmd.arg("-y").arg("-i").arg(source_path);

    if preserve_gif_animation {
        let gif_filter = format!(
            "{base_filter},split[s0][s1];[s0]palettegen=reserve_transparent=on[p];[s1][p]paletteuse=dither=sierra2_4a"
        );
        cmd.arg("-vf")
            .arg(gif_filter)
            .arg("-loop")
            .arg("0")
            .arg(destination);
    } else {
        cmd.arg("-vf")
            .arg(base_filter)
            .args([
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ])
            .arg(destination);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run ffmpeg ({}): {e}", ffmpeg.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffmpeg failed to transform background".to_string()
        } else {
            format!("ffmpeg failed to transform background: {stderr}")
        });
    }

    Ok(destination.to_string_lossy().to_string())
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

fn run_native_crop(
    source_path: &str,
    destination: &Path,
    crop: &CropData,
) -> Result<String, String> {
    let mut img = image::open(source_path).map_err(|e| format!("Failed to open image: {e}"))?;

    let rotation = crop.rotation.rem_euclid(360);
    img = match rotation {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };

    if crop.flip_h {
        img = img.fliph();
    }

    if crop.flip_v {
        img = img.flipv();
    }

    let img_width = img.width() as i64;
    let img_height = img.height() as i64;
    if img_width <= 0 || img_height <= 0 {
        return Err("Invalid image dimensions".to_string());
    }

    let x = crop.x.round().max(0.0) as i64;
    let y = crop.y.round().max(0.0) as i64;
    let w = crop.width.round().max(1.0) as i64;
    let h = crop.height.round().max(1.0) as i64;

    let x = x.min(img_width - 1);
    let y = y.min(img_height - 1);
    let max_w = img_width - x;
    let max_h = img_height - y;
    let crop_w = w.min(max_w).max(1);
    let crop_h = h.min(max_h).max(1);

    let cropped = img.crop_imm(x as u32, y as u32, crop_w as u32, crop_h as u32);

    let ext = destination
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "jpg" || ext == "jpeg" {
        let rgb: DynamicImage = if cropped.color().has_alpha() {
            DynamicImage::ImageRgb8(cropped.to_rgb8())
        } else {
            cropped
        };

        let mut output_file = fs::File::create(destination)
            .map_err(|e| format!("Failed to create output file: {e}"))?;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output_file, 95);
        encoder
            .encode_image(&rgb)
            .map_err(|e| format!("Failed to write JPEG: {e}"))?;
    } else {
        cropped
            .save(destination)
            .map_err(|e| format!("Failed to save image: {e}"))?;
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
    } else if is_video_extension(&ext) {
        backgrounds_dir.join("background.mp4")
    } else {
        backgrounds_dir.join("background.jpg")
    };

    let source_path_for_worker = source_path.clone();
    let app_for_worker = app.clone();
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

        if source_ext == "gif" {
            return run_ffmpeg_transform(
                &app_for_worker,
                &source_path_for_worker,
                &destination,
                &crop,
                true,
            );
        }

        if is_video_extension(&source_ext) {
            return run_ffmpeg_transform(
                &app_for_worker,
                &source_path_for_worker,
                &destination,
                &crop,
                false,
            );
        }

        run_native_crop(&source_path_for_worker, &destination, &crop)
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

        run_native_crop(&source_path_for_worker, &destination, &crop)
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

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn reveal_in_file_manager(file_path: String) -> Result<(), String> {
    let raw_path = PathBuf::from(file_path.trim());
    if !raw_path.exists() {
        return Err("Exported file no longer exists on disk.".to_string());
    }

    let path = fs::canonicalize(&raw_path).unwrap_or(raw_path);
    let path_string = path.to_string_lossy().to_string();

    Command::new("explorer")
        .arg("/select,")
        .arg(path_string)
        .spawn()
        .map_err(|e| format!("Failed to open Explorer: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn reveal_in_file_manager(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path.trim());
    let dir = path
        .parent()
        .ok_or("Could not resolve exported file directory.".to_string())?;

    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    Command::new(opener)
        .arg(dir)
        .spawn()
        .map_err(|e| format!("Failed to open file manager: {e}"))?;

    Ok(())
}
