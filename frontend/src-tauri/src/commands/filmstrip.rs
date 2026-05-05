use std::path::Path;
use std::process::Command;

use tauri::AppHandle;

use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::process::apply_no_window;

/// Generate a horizontal filmstrip sprite sheet from a video file.
///
/// Extracts `frame_count` frames at evenly spaced intervals, each scaled to
/// `thumb_width × thumb_height`, and stitches them into a single horizontal
/// JPEG image. The output path is deterministic based on the input hash so
/// repeated calls for the same video are served from cache.
///
/// When `start_time` is provided, extraction begins at that offset (useful
/// for split clips that reference a subrange of a larger source file).
///
/// Returns the absolute path of the generated sprite sheet.
#[tauri::command]
pub async fn generate_filmstrip(
    app: AppHandle,
    video_path: String,
    output_dir: String,
    duration: f64,
    frame_count: u32,
    thumb_width: u32,
    thumb_height: u32,
    start_time: Option<f64>,
) -> Result<String, String> {
    if duration <= 0.0 || frame_count == 0 {
        return Err("Invalid duration or frame count".into());
    }

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;

    // Deterministic output name based on video path + params so we can cache
    let effective_start = start_time.unwrap_or(0.0);
    let hash = simple_hash(
        &video_path,
        frame_count,
        thumb_width,
        thumb_height,
        effective_start,
        duration,
    );
    let output_path = Path::new(&output_dir).join(format!("filmstrip_{hash}.jpg"));
    let output_str = output_path.to_string_lossy().to_string();

    // If the filmstrip already exists, return it immediately (cache hit)
    if output_path.exists() {
        console_log("FILMSTRIP|cache_hit", &output_str);
        return Ok(output_str);
    }

    // Ensure output dir exists
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }

    console_log(
        "FILMSTRIP|generate",
        &format!(
            "video={} frames={} size={}x{} dur={:.2}s start={:.2}s",
            Path::new(&video_path)
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or("?"),
            frame_count,
            thumb_width,
            thumb_height,
            duration,
            effective_start,
        ),
    );

    // Use FFmpeg's fps filter to extract frames at even intervals, then tile
    // them into a single horizontal strip using the tile filter.
    //
    // fps=N/duration extracts N frames evenly across the whole video.
    // scale=WxH resizes each frame.
    // tile=Nx1 stitches them into one horizontal image.
    let filter =
        format!("thumbnail={frame_count},scale={thumb_width}:{thumb_height},tile={frame_count}x1");

    // Build args — optionally prepend -ss for start time and -t for duration
    let start_str = format!("{:.6}", effective_start);
    let dur_str = format!("{:.6}", duration);

    let mut args: Vec<&str> = vec!["-y"];

    if effective_start > 0.01 {
        args.extend_from_slice(&["-ss", &start_str]);
    }

    args.extend_from_slice(&[
        "-i",
        &video_path,
        "-t",
        &dur_str,
        "-vf",
        &filter,
        "-frames:v",
        "1",
        "-q:v",
        "6", // JPEG quality: 2=best, 31=worst. 6 is a good balance for small sprites
        "-pix_fmt",
        "yuvj420p", // MJPEG requires yuvj420p for full range support in some versions
        "-strict",
        "-2",  // Allow non-standard features
        "-an", // No audio
        &output_str,
    ]);

    let ffmpeg_clone = ffmpeg.clone();
    let args_owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        let output = cmd
            .args(&args_owned)
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg filmstrip failed: {}", stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Filmstrip task panicked: {e}"))??;

    console_log("FILMSTRIP|done", &output_str);
    Ok(output_str)
}

/// Simple hash function for deterministic filenames.
/// Not cryptographic, just needs to be unique per input combination.
fn simple_hash(path: &str, count: u32, w: u32, h: u32, start: f64, duration: f64) -> String {
    let mut hash: u64 = 0xcbf29ce484222325; // FNV offset basis
    let prime: u64 = 0x100000001b3;

    for byte in path.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(prime);
    }
    // Mix in params
    hash ^= count as u64;
    hash = hash.wrapping_mul(prime);
    hash ^= w as u64;
    hash = hash.wrapping_mul(prime);
    hash ^= h as u64;
    hash = hash.wrapping_mul(prime);
    // Mix in start time (rounded to centiseconds for stability)
    hash ^= (start * 100.0) as u64;
    hash = hash.wrapping_mul(prime);
    // Mix in duration (rounded to centiseconds)
    hash ^= (duration * 100.0) as u64;
    hash = hash.wrapping_mul(prime);

    format!("{hash:016x}")
}
