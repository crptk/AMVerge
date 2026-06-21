use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

#[cfg(not(windows))]
use std::os::unix::process::CommandExt;

use tauri::{AppHandle, State};
use serde::Serialize;

use crate::state::{ActiveFfmpegPids, PreviewProxyLocks};
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAudioStream {
    pub audio_stream_index: u32,
    pub label: String,
}

fn normalize_language_label(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "jpn" | "ja" => "Japanese".to_string(),
        "eng" | "en" => "English".to_string(),
        "spa" | "es" => "Spanish".to_string(),
        "fra" | "fre" | "fr" => "French".to_string(),
        "deu" | "ger" | "de" => "German".to_string(),
        "ita" | "it" => "Italian".to_string(),
        "por" | "pt" => "Portuguese".to_string(),
        "rus" | "ru" => "Russian".to_string(),
        "kor" | "ko" => "Korean".to_string(),
        "zho" | "chi" | "zh" => "Chinese".to_string(),
        "ara" | "ar" => "Arabic".to_string(),
        "hin" | "hi" => "Hindi".to_string(),
        "tha" | "th" => "Thai".to_string(),
        "vie" | "vi" => "Vietnamese".to_string(),
        "ind" | "id" => "Indonesian".to_string(),
        "tur" | "tr" => "Turkish".to_string(),
        "pol" | "pl" => "Polish".to_string(),
        "nld" | "dut" | "nl" => "Dutch".to_string(),
        "swe" | "sv" => "Swedish".to_string(),
        "nor" | "no" => "Norwegian".to_string(),
        "dan" | "da" => "Danish".to_string(),
        "fin" | "fi" => "Finnish".to_string(),
        "ukr" | "uk" => "Ukrainian".to_string(),
        "ces" | "cze" | "cs" => "Czech".to_string(),
        "ron" | "rum" | "ro" => "Romanian".to_string(),
        "hun" | "hu" => "Hungarian".to_string(),
        _ => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                "Unknown".to_string()
            } else {
                trimmed.to_string()
            }
        }
    }
}

#[tauri::command]
pub async fn get_audio_streams(app: AppHandle, video_path: String) -> Result<Vec<PreviewAudioStream>, String> {
    if video_path.trim().is_empty() {
        return Err("video_path is empty".to_string());
    }

    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;

    let ffprobe_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        cmd.args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index:stream_tags=language,title",
            "-of",
            "json",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))??;

    if !ffprobe_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffprobe_output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe failed while reading audio streams".to_string()
        } else {
            format!("ffprobe failed while reading audio streams: {stderr}")
        });
    }

    let parsed: serde_json::Value = serde_json::from_slice(&ffprobe_output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe json: {e}"))?;

    let streams = parsed
        .get("streams")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out: Vec<PreviewAudioStream> = Vec::with_capacity(streams.len());
    for (audio_order_index, stream) in streams.into_iter().enumerate() {
        let tags = stream.get("tags").and_then(|v| v.as_object());
        let language_raw = tags
            .and_then(|t| t.get("language"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let title = tags
            .and_then(|t| t.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let language = normalize_language_label(language_raw);
        let label = if title.is_empty() {
            format!("{} ({})", language, audio_order_index + 1)
        } else {
            format!("{} - {} ({})", language, title, audio_order_index + 1)
        };

        out.push(PreviewAudioStream {
            audio_stream_index: audio_order_index as u32,
            label,
        });
    }

    Ok(out)
}

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
    ffmpeg_pids: State<'_, ActiveFfmpegPids>,
    clip_path: String,
    audio_stream_index: Option<u32>,
    transcode_video: Option<bool>,
) -> Result<String, String> {
    let transcode_video = transcode_video.unwrap_or(true);
    let audio_suffix = audio_stream_index
        .map(|idx| format!("a{idx}"))
        .unwrap_or_else(|| "na".to_string());
    // "aac" = copy video + transcode audio to AAC (stream-copying audio into MP4 breaks
    // duration for codecs like FLAC, DTS, EAC3 — browser reports Infinity, seeks fail).
    // "x264" = transcode both. "copy" = copy video, no audio (audio_stream_index = None).
    let mode_suffix = if transcode_video {
        "x264"
    } else if audio_stream_index.is_some() {
        "aac"
    } else {
        "copy"
    };
    let clip_key = format!("{}::{audio_suffix}::{mode_suffix}", clip_path);
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

    let proxy_path = parent.join(format!("{stem}.{audio_suffix}.{mode_suffix}.preview.mp4"));
    let proxy_tmp_path = parent.join(format!("{stem}.{audio_suffix}.{mode_suffix}.preview.tmp.mp4"));

    if let Ok(meta) = std::fs::metadata(&proxy_path) {
        if meta.is_file() && meta.len() > 0 {
            return Ok(proxy_path.to_string_lossy().to_string());
        }
    }

    let _ = std::fs::remove_file(&proxy_tmp_path);

    let ffmpeg_clone = ffmpeg.clone();
    let input = input_path.clone();
    let output = proxy_tmp_path.clone();
    let pids = ffmpeg_pids.pids.clone();

    let ffmpeg_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        #[cfg(not(windows))]
        cmd.process_group(0);
        cmd.args(["-y", "-i"]);
        cmd.arg(&input);
        cmd.args(["-map", "0:v:0"]);

        if let Some(audio_index) = audio_stream_index {
            cmd.args(["-map", &format!("0:a:{audio_index}?")]);
        }

        if transcode_video {
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
            ]);

            if audio_stream_index.is_some() {
                cmd.args(["-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000"]);
            } else {
                cmd.args(["-an"]);
            }
        } else {
            cmd.args(["-c:v", "copy"]);
            if audio_stream_index.is_some() {
                // Always transcode audio to AAC — stream-copying from MKV into MP4 can
                // produce a container the browser can't determine duration for (Infinity),
                // which breaks timeline seeking regardless of -movflags +faststart.
                cmd.args(["-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000"]);
            } else {
                cmd.args(["-an"]);
            }
        }

        cmd.args(["-movflags", "+faststart"]);
        cmd.arg(&output);

        let child = cmd
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
        let pid = child.id();
        if let Ok(mut l) = pids.lock() { l.push(pid); }
        let result = child.wait_with_output().map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;
        if let Ok(mut l) = pids.lock() { l.retain(|p| *p != pid); }
        Ok::<std::process::Output, String>(result)
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
    ffmpeg_pids: State<'_, ActiveFfmpegPids>,
    srcs: Vec<String>,
    audio_stream_index: Option<u32>,
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
    audio_stream_index.hash(&mut hasher);
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
    let pids = ffmpeg_pids.pids.clone();

    let ffmpeg_result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        #[cfg(not(windows))]
        cmd.process_group(0);
        let list_str = list_clone.to_str().ok_or_else(|| "Invalid list path".to_string())?;
        let out_str = output_clone.to_str().ok_or_else(|| "Invalid output path".to_string())?;
        cmd.args(["-y", "-f", "concat", "-safe", "0", "-i", list_str, "-map", "0:v:0"]);
        if let Some(audio_index) = audio_stream_index {
            cmd.args(["-map", &format!("0:a:{audio_index}?")]);
            cmd.args(["-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000"]);
        } else {
            cmd.args(["-c", "copy"]);
        }
        cmd.arg(out_str);

        let child = cmd
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
        let pid = child.id();
        if let Ok(mut l) = pids.lock() { l.push(pid); }
        let result = child.wait_with_output().map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;
        if let Ok(mut l) = pids.lock() { l.retain(|p| *p != pid); }
        Ok::<std::process::Output, String>(result)
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
    Ok(final_path)
}
