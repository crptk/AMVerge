use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::state::PreviewProxyLocks;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

#[tauri::command]
pub async fn check_hevc(app: AppHandle, video_path: String) -> Result<bool, String> {
    if video_path.trim().is_empty() {
        return Err("video_path is empty".to_string());
    }

    let video_name = file_name_only(&video_path);

    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    let ffprobe_name = ffprobe
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("ffprobe.exe")
        .to_string();

    let ffprobe_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        cmd.args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=nk=1:nw=1",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))??;

    if !ffprobe_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffprobe_output.stderr)
            .trim()
            .to_string();

        if !stderr.is_empty() {
            console_log(
                "ERROR|check_hevc",
                &format!("{ffprobe_name} failed for {video_name}: {stderr}"),
            );
        } else {
            console_log(
                "ERROR|check_hevc",
                &format!("{ffprobe_name} failed for {video_name}"),
            );
        }

        return Err(if stderr.is_empty() {
            "ffprobe failed".to_string()
        } else {
            format!("ffprobe failed: {stderr}")
        });
    }

    let codec = String::from_utf8_lossy(&ffprobe_output.stdout)
        .trim()
        .to_ascii_lowercase();

    Ok(codec == "hevc")
}

#[tauri::command]
pub async fn hover_preview_error(
    clip_id: String,
    clip_path: String,
    error_code: Option<u16>,
) -> Result<(), String> {
    let clip_id = clip_id.replace('\n', " ").replace('\r', " ");
    let clip_path = clip_path.replace('\n', " ").replace('\r', " ");
    println!(
        "hover_preview_error|clip_id={}|clip_path={}|error_code={:?}",
        clip_id, clip_path, error_code
    );

    Ok(())
}

#[tauri::command]
pub async fn ensure_preview_proxy(
    app: AppHandle,
    proxy_locks: State<'_, PreviewProxyLocks>,
    clip_path: String,
) -> Result<String, String> {
    let clip_key = clip_path.clone();
    let clip_lock = {
        let mut map = proxy_locks.inner.lock().await;
        map.retain(|_, v| Arc::strong_count(v) > 1);
        map.entry(clip_key.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = clip_lock.lock().await;

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    console_log(
        "PROXY|start",
        &format!(
            "clip={} ffmpeg={}",
            file_name_only(&clip_path),
            ffmpeg.display()
        ),
    );

    let input_path = PathBuf::from(&clip_path);
    if !input_path.exists() {
        return Err(format!("Clip not found: {}", input_path.display()));
    }

    let parent = input_path
        .parent()
        .ok_or("Invalid clip path (no parent directory)")?;

    let stem = input_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("Invalid clip filename")?;

    let proxy_path = parent.join(format!("{stem}.preview.mp4"));
    let proxy_tmp_path = parent.join(format!("{stem}.preview.tmp.mp4"));

    if let Ok(meta) = std::fs::metadata(&proxy_path) {
        if meta.is_file() && meta.len() > 0 {
            return Ok(proxy_path.to_string_lossy().to_string());
        }
    }

    let _ = std::fs::remove_file(&proxy_tmp_path);

    let ffmpeg_clone = ffmpeg.clone();
    let input = input_path.clone();
    let output = proxy_tmp_path.clone();

    let ffmpeg_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        cmd.args(["-y", "-i"]);
        cmd.arg(&input);
        cmd.args([
            "-c:v",
            "libx264",
            "-vf",
            "scale=-2:480",
            "-g",
            "1",
            "-preset",
            "veryfast",
            "-crf",
            "32",
            "-pix_fmt",
            "yuv420p",
            "-an", // No audio for preview proxy to speed up extraction
            "-movflags",
            "+faststart",
        ]);
        cmd.arg(&output);

        cmd.output()
            .map_err(|e| format!("Failed to run ffmpeg: {e}"))
    })
    .await
    .map_err(|e| format!("ffmpeg task panicked: {e}"))??;

    if !ffmpeg_output.status.success() {
        let _ = std::fs::remove_file(&proxy_tmp_path);
        let mut stderr = String::from_utf8_lossy(&ffmpeg_output.stderr).to_string();

        let in_full = input_path.to_string_lossy().to_string();
        let in_base = file_name_only(&in_full);
        if in_full != in_base {
            stderr = stderr.replace(&in_full, &in_base);
        }
        let out_full = proxy_tmp_path.to_string_lossy().to_string();
        let out_base = file_name_only(&out_full);
        if out_full != out_base {
            stderr = stderr.replace(&out_full, &out_base);
        }
        stderr = stderr.trim().to_string();

        if !stderr.is_empty() {
            console_log("ERROR|proxy", &stderr);
        } else {
            console_log("ERROR|proxy", "FFmpeg proxy encode failed");
        }
        return Err(if stderr.is_empty() {
            "FFmpeg proxy encode failed".to_string()
        } else {
            format!("FFmpeg proxy encode failed: {stderr}")
        });
    }

    let meta = std::fs::metadata(&proxy_tmp_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&proxy_tmp_path);
        return Err("Proxy encode produced empty file".to_string());
    }

    match std::fs::remove_file(&proxy_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to remove existing proxy: {e}")),
    }

    if let Err(e) = std::fs::rename(&proxy_tmp_path, &proxy_path) {
        std::fs::copy(&proxy_tmp_path, &proxy_path)
            .map_err(|copy_err| format!("Failed to publish proxy (rename={e}, copy={copy_err})"))?;
        let _ = std::fs::remove_file(&proxy_tmp_path);
    }

    let final_path = proxy_path.to_string_lossy().to_string();
    console_log(
        "PROXY|end",
        &format!("ok proxy={}", file_name_only(&final_path)),
    );
    Ok(final_path)
}

#[tauri::command]
pub async fn ensure_merged_preview(
    app: AppHandle,
    proxy_locks: State<'_, PreviewProxyLocks>,
    srcs: Vec<String>,
) -> Result<String, String> {
    if srcs.is_empty() {
        return Err("srcs is empty".to_string());
    }
    if srcs.len() == 1 {
        return Ok(srcs[0].clone());
    }

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    srcs.hash(&mut hasher);
    let hash = hasher.finish();

    let first_path = PathBuf::from(&srcs[0]);
    let parent = first_path
        .parent()
        .ok_or("Invalid src path (no parent directory)")?;
    let stem = first_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid src filename")?;

    let preview_path = parent.join(format!("{stem}.merged.{hash:016x}.preview.mp4"));
    let preview_tmp_path = parent.join(format!("{stem}.merged.{hash:016x}.preview.tmp.mp4"));
    let list_path = parent.join(format!("{stem}.merged.{hash:016x}.concat.txt"));

    let lock_key = preview_path.to_string_lossy().to_string();
    let clip_lock = {
        let mut map = proxy_locks.inner.lock().await;
        map.retain(|_, v| Arc::strong_count(v) > 1);
        map.entry(lock_key)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = clip_lock.lock().await;

    if let Ok(meta) = std::fs::metadata(&preview_path) {
        if meta.is_file() && meta.len() > 0 {
            return Ok(preview_path.to_string_lossy().to_string());
        }
    }

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    console_log(
        "MERGED_PREVIEW|start",
        &format!("clips={} first={}", srcs.len(), file_name_only(&srcs[0])),
    );

    let content: String = srcs
        .iter()
        .map(|s| format!("file '{}'\n", s.replace('\'', "'\\''")))
        .collect();
    std::fs::write(&list_path, &content)
        .map_err(|e| format!("Failed to write concat list: {e}"))?;

    let _ = std::fs::remove_file(&preview_tmp_path);

    let ffmpeg_clone = ffmpeg.clone();
    let list_clone = list_path.clone();
    let output_clone = preview_tmp_path.clone();

    let ffmpeg_result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        cmd.args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list_clone
                .to_str()
                .ok_or_else(|| "Invalid list path".to_string())?,
            "-c",
            "copy",
            output_clone
                .to_str()
                .ok_or_else(|| "Invalid output path".to_string())?,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))
    })
    .await
    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

    let _ = std::fs::remove_file(&list_path);
    let ffmpeg_output = ffmpeg_result?;

    if !ffmpeg_output.status.success() {
        let _ = std::fs::remove_file(&preview_tmp_path);
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr)
            .trim()
            .to_string();
        console_log(
            "ERROR|merged_preview",
            &if stderr.is_empty() {
                "FFmpeg merged preview failed".to_string()
            } else {
                stderr.clone()
            },
        );
        return Err(if stderr.is_empty() {
            "FFmpeg merged preview failed".to_string()
        } else {
            format!("FFmpeg merged preview failed: {stderr}")
        });
    }

    let meta = std::fs::metadata(&preview_tmp_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&preview_tmp_path);
        return Err("Merged preview produced empty file".to_string());
    }

    match std::fs::remove_file(&preview_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to remove existing merged preview: {e}")),
    }

    if let Err(e) = std::fs::rename(&preview_tmp_path, &preview_path) {
        std::fs::copy(&preview_tmp_path, &preview_path).map_err(|copy_err| {
            format!("Failed to publish merged preview (rename={e}, copy={copy_err})")
        })?;
        let _ = std::fs::remove_file(&preview_tmp_path);
    }

    let final_path = preview_path.to_string_lossy().to_string();
    console_log(
        "MERGED_PREVIEW|end",
        &format!("ok file={}", file_name_only(&final_path)),
    );
    Ok(final_path)
}
