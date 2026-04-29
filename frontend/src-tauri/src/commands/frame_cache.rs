use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::process::apply_no_window;

/// Extracts all frames from a video file as downscaled PNGs into a cache directory.
/// This is used for the high-precision timeline filmstrip.
#[tauri::command]
pub async fn extract_video_frames(
    app: AppHandle,
    video_path: String,
    cache_id: String, // Unique ID for this video (e.g. hash or uuid)
    width: u32,
) -> Result<String, String> {
    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_data.join("frame_cache").join(&cache_id);
    
    // If cache already exists and has files, skip extraction
    if cache_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&cache_dir) {
            if entries.count() > 0 {
                console_log("FRAME_CACHE|hit", &cache_id);
                return Ok(cache_dir.to_string_lossy().to_string());
            }
        }
    }

    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache dir: {e}"))?;

    console_log("FRAME_CACHE|extracting", &format!("video={} id={} width={}", video_path, cache_id, width));

    // ffmpeg -i input -vf "scale=W:-1" -q:v 2 output/frame_%04d.png
    // Using PNG for quality, though JPEG might be smaller.
    // %06d allows for very long videos.
    let output_pattern = cache_dir.join("frame_%06d.png");
    let output_str = output_pattern.to_string_lossy().to_string();
    
    // Force a consistent 30fps for the filmstrip to ensure predictable frame indexing
    let filter = format!("fps=30,scale={}:-1", width);

    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg);
        apply_no_window(&mut cmd);
        cmd.args(&[
            "-y",
            "-i", &video_path,
            "-vf", &filter,
            "-vsync", "0", 
            &output_str,
        ]);
        cmd.output()
    })
    .await
    .map_err(|e| format!("FFmpeg task panicked: {e}"))?
    .map_err(|e| format!("Failed to start extraction: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        console_log("ERROR|FRAME_CACHE", &format!("FFmpeg failed for {}: {}", cache_id, stderr));
        return Err(format!("FFmpeg frame extraction failed: {}", stderr));
    }

    console_log("FRAME_CACHE|done", &format!("id={} path={}", cache_id, cache_dir.display()));
    Ok(cache_dir.to_string_lossy().to_string())
}

/// Retrieves the total frame count and frame rate of a video.
#[tauri::command]
pub async fn get_video_frame_info(app: AppHandle, video_path: String) -> Result<(u64, f64), String> {
    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    
    // We force 30fps in extraction, so we should report 30.0 here for consistency
    // However, we still need the duration to estimate total frames if nb_frames is missing.
    // Let's get r_frame_rate and duration instead.
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        cmd.args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=nb_frames,r_frame_rate,duration",
            "-of", "csv=p=0",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {e}"))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))??;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut parts = stdout.trim().split(',');
    
    // Format: frame_rate,nb_frames,duration
    let frame_rate_str = parts.next().ok_or("Missing frame rate")?;
    let nb_frames_str = parts.next().ok_or("Missing frame count")?;
    let duration_str = parts.next().unwrap_or("0");
    
    let duration = duration_str.parse::<f64>().unwrap_or(0.0);
    let mut nb_frames = nb_frames_str.parse::<u64>().unwrap_or(0);
    
    // Parse r_frame_rate
    let fps_parts: Vec<&str> = frame_rate_str.split('/').collect();
    let _native_fps = if fps_parts.len() == 2 {
        let num = fps_parts[0].parse::<f64>().unwrap_or(30.0);
        let den = fps_parts[1].parse::<f64>().unwrap_or(1.0);
        if den == 0.0 { 30.0 } else { num / den }
    } else {
        frame_rate_str.parse::<f64>().unwrap_or(30.0)
    };

    // If we are forcing 30fps in extraction, the total frames will be duration * 30
    if nb_frames == 0 && duration > 0.0 {
        nb_frames = (duration * 30.0) as u64;
    }

    Ok((nb_frames, 30.0)) // Always return 30.0 since we force it in extraction
}

/// Retrieves the absolute path to the frame cache directory for a given ID.
#[tauri::command]
pub async fn get_frame_cache_path(app: AppHandle, cache_id: String) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_data.join("frame_cache").join(&cache_id);
    Ok(cache_dir.to_string_lossy().to_string())
}

/// Deletes the frame cache for a specific video ID.
#[tauri::command]
pub async fn delete_frame_cache(app: AppHandle, cache_id: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_data.join("frame_cache").join(&cache_id);
    
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir).map_err(|e| format!("Failed to delete cache: {e}"))?;
        console_log("FRAME_CACHE|deleted", &cache_id);
    }
    
    Ok(())
}

/// Clears the entire frame cache directory.
#[tauri::command]
pub async fn clear_all_frame_caches(app: AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root_cache_dir = app_data.join("frame_cache");
    
    if root_cache_dir.exists() {
        std::fs::remove_dir_all(&root_cache_dir).map_err(|e| format!("Failed to clear all caches: {e}"))?;
        console_log("FRAME_CACHE|all_cleared", "");
    }
    
    Ok(())
}
