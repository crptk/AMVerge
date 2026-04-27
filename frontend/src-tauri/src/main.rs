#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! AMVerge Tauri backend entrypoint.
//!
//! This file is the bridge between the React frontend and the Python/FFmpeg backend.
//!
//! Main responsibilities:
//! - start/abort scene detection
//! - emit progress events to the frontend
//! - export selected clips, either separately or merged
//! - generate browser-friendly preview proxies for unsupported codecs
//! - clean episode cache folders
//!
//! Rust note: this file is intentionally kept in one place for now.
//! I’m far more comfortable in React/TypeScript and Python, so the Rust side was built
//! mainly as a practical Tauri bridge for native desktop packaging and frontend/backend communication.
//!
//! It may be refactored into modules later as the project grows.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Mutex as AsyncMutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Clone)]
struct ProgressPayload {
    percent: u8,
    message: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TimelineXmlClip {
    id: String,
    src: String,
    original_name: Option<String>,
    original_path: Option<String>,
    scene_index: Option<u32>,
    start_sec: Option<f64>,
    end_sec: Option<f64>,
}

#[derive(Debug, Clone)]
struct SourceVideoMeta {
    fps_num: u32,
    fps_den: u32,
    timebase: u32,
    ntsc: bool,
    width: u32,
    height: u32,
    duration_sec: f64,
    audio_sample_rate: u32,
    audio_channels: u32,
}

#[derive(Debug, Clone)]
struct TimelineClipSegment {
    name: String,
    source_in: i64,
    source_out: i64,
    timeline_start: i64,
    timeline_end: i64,
}

// ============================================================================
// Shared app state
// ============================================================================

#[derive(Default)]
struct ActiveSidecar {
    pid: Mutex<Option<u32>>,
}

// ============================================================================
// Logging and path display helpers
// ============================================================================

fn file_name_only(s: &str) -> String {
    let p = Path::new(s);
    p.file_name()
        .and_then(|x| x.to_str())
        .unwrap_or(s)
        .to_string()
}

fn dir_name_only(p: &Path) -> String {
    if let Some(name) = p.file_name().and_then(|x| x.to_str()) {
        return name.to_string();
    }
    p.to_string_lossy().to_string()
}

fn sanitize_for_console(s: &str) -> String {
    // Keep it single-line and screenshot friendly.
    s.replace('\r', " ").replace('\n', " ")
}

fn console_log(tag: &str, msg: &str) {
    let tag = sanitize_for_console(tag);
    let msg = sanitize_for_console(msg);
    println!("AMVERGE|{}|{}", tag, msg);
}

fn sanitize_line_with_known_paths(
    line: &str,
    input_full: &str,
    input_base: &str,
    output_full: &str,
    output_base: &str,
) -> String {
    let mut s = line.to_string();
    if !input_full.is_empty() && input_full != input_base {
        s = s.replace(input_full, input_base);
    }
    if !output_full.is_empty() && output_full != output_base {
        s = s.replace(output_full, output_base);
    }
    s
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn apply_no_window(cmd: &mut Command) {
    // Prevent additional console windows from appearing for child processes.
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn sanitize_episode_cache_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() {
        return Err("episode_cache_id is empty".to_string());
    }

    // Keep paths safe and predictable.
    // Allow UUIDs and simple user-generated ids.
    if id.len() > 96 {
        return Err("episode_cache_id is too long".to_string());
    }

    let ok = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err("episode_cache_id contains invalid characters".to_string());
    }

    Ok(id.to_string())
}

fn clear_files_in_dir(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn percent_encode_uri_path(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 16);

    for &b in raw.as_bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '/' | ':' | '.' | '-' | '_' | '~') {
            out.push(c);
        } else {
            out.push('%');
            out.push_str(&format!("{b:02X}"));
        }
    }

    out
}

fn path_to_file_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let encoded = percent_encode_uri_path(&normalized);

    // Premiere is strict on Windows pathurl shape in FCP7 XML.
    // Prefer file://localhost/C%3a/... over more relaxed variants.
    if normalized.len() >= 3 {
        let bytes = normalized.as_bytes();
        let drive = bytes[0] as char;
        let has_drive_colon = drive.is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
        if has_drive_colon {
            let drive_letter = drive.to_ascii_uppercase();
            let rest = &normalized[2..];
            let encoded_rest = percent_encode_uri_path(rest);
            return format!("file://localhost/{}%3a{}", drive_letter, encoded_rest);
        }
    }

    if normalized.starts_with("//") {
        return format!("file://localhost{encoded}");
    }

    format!("file://localhost///{}", encoded.trim_start_matches('/'))
}

fn parse_ffprobe_ratio(raw: Option<&str>) -> Option<(u32, u32)> {
    let text = raw?.trim();
    if text.is_empty() || text == "0/0" {
        return None;
    }

    if let Some((a, b)) = text.split_once('/') {
        let num = a.trim().parse::<u32>().ok()?;
        let den = b.trim().parse::<u32>().ok()?;
        if num == 0 || den == 0 {
            return None;
        }
        return Some((num, den));
    }

    let value = text.parse::<f64>().ok()?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }

    let scaled = (value * 1000.0).round() as u32;
    if scaled == 0 {
        return None;
    }

    Some((scaled, 1000))
}

fn parse_ffprobe_u32(value: Option<&serde_json::Value>) -> Option<u32> {
    let v = value?;
    if let Some(n) = v.as_u64() {
        return u32::try_from(n).ok();
    }
    if let Some(s) = v.as_str() {
        return s.trim().parse::<u32>().ok();
    }
    None
}

fn classify_timebase_ntsc(fps: f64) -> (u32, bool) {
    if (fps - 23.976).abs() < 0.02 {
        return (24, true);
    }
    if (fps - 29.97).abs() < 0.02 {
        return (30, true);
    }
    if (fps - 59.94).abs() < 0.02 {
        return (60, true);
    }

    let rounded = fps.round() as i64;
    let clamped = rounded.clamp(1, i64::from(u32::MAX)) as u32;
    (clamped, false)
}

fn seconds_to_frames(seconds: f64, fps_num: u32, fps_den: u32) -> i64 {
    if fps_num == 0 || fps_den == 0 {
        return 0;
    }

    let safe = if seconds.is_finite() {
        seconds.max(0.0)
    } else {
        0.0
    };

    ((safe * f64::from(fps_num) / f64::from(fps_den)).round() as i64).max(0)
}

// ============================================================================
// Preview proxy locking
// ============================================================================

#[derive(Default)]
struct PreviewProxyLocks {
    // One async mutex per clip path.
    // Prevents concurrent encodes of the same preview proxy (which can produce partial files).
    inner: AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

// ============================================================================
// Preview proxy locking
// ============================================================================

#[tauri::command]
fn save_background_image(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

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

// ============================================================================
// Commands: codec checks
// ============================================================================

#[tauri::command]
async fn check_hevc(app: AppHandle, video_path: String) -> Result<bool, String> {
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

// ============================================================================
// Commands: scene detection
// ============================================================================

#[tauri::command]
async fn detect_scenes(
    app: AppHandle,
    sidecar_state: State<'_, ActiveSidecar>,
    video_path: String,
    episode_cache_id: Option<String>,
) -> Result<String, String> {
    let video_name = file_name_only(&video_path);
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let output_dir = if let Some(raw_id) = episode_cache_id.as_deref() {
        let id = sanitize_episode_cache_id(raw_id)?;
        app_data_dir.join("episodes").join(id)
    } else {
        app_data_dir.clone()
    };

    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    clear_files_in_dir(&output_dir);
    let output_dir_str = output_dir.to_string_lossy().to_string();

    console_log(
        "SCENE|start",
        &format!(
            "video={video_name} output_dir={}",
            dir_name_only(&output_dir)
        ),
    );

    let output_dir_base = dir_name_only(&output_dir);

    let mut child = if cfg!(debug_assertions) {
        // DEV MODE → run python script from /backend using the local venv
        let mut root = std::env::current_dir().map_err(|e| e.to_string())?;
        root.pop();
        root.pop();

        let script_path = root.join("backend").join("app.py");
        let python_path = root
            .join("backend")
            .join("venv")
            .join("Scripts")
            .join("python.exe");

        let python_name = python_path
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("python.exe");
        console_log(
            "SCENE|spawn",
            &format!(
                "mode=dev exe={python_name} script=app.py args=[{video_name},{output_dir_base}]"
            ),
        );

        let mut cmd = Command::new(python_path);
        apply_no_window(&mut cmd);
        cmd.arg(script_path)
            .arg(&video_path)
            .arg(&output_dir_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn python: {e}"))?
    } else {
        // PRODUCTION → run bundled backend exe from resources
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Can't find current exe: {e}"))?
            .parent()
            .ok_or("Can't get exe directory")?
            .to_path_buf();

        let backend = app
            .path()
            .resolve(
                "bin/backend_script-x86_64-pc-windows-msvc/backend_script.exe",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| e.to_string())?;

        let backend_name = backend
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("backend_script.exe");
        console_log(
            "SCENE|spawn",
            &format!("mode=prod exe={backend_name} args=[{video_name},{output_dir_base}]"),
        );

        let mut cmd = Command::new(backend);
        apply_no_window(&mut cmd);
        cmd.current_dir(&exe_dir)
            .arg(&video_path)
            .arg(&output_dir_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn backend exe: {e}"))?
    };

    let child_pid = child.id();
    console_log("SCENE|pid", &format!("pid={}", child_pid));

    // Store PID so abort_detect_scenes can kill this process tree.
    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = Some(child_pid);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stderr_accum = Arc::new(Mutex::new(String::new()));
    let app_for_thread = app.clone();
    let stderr_accum_for_thread = Arc::clone(&stderr_accum);

    let input_full_for_thread = video_path.clone();
    let input_base_for_thread = video_name.clone();
    let output_full_for_thread = output_dir_str.clone();
    let output_base_for_thread = output_dir_base.clone();

    let stderr_handle = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stderr);
        const STDERR_CAP: usize = 256 * 1024; // 256 KB
        for line in reader.lines().flatten() {
            if !line.starts_with("PROGRESS|") {
                let sanitized = sanitize_line_with_known_paths(
                    &line,
                    &input_full_for_thread,
                    &input_base_for_thread,
                    &output_full_for_thread,
                    &output_base_for_thread,
                );
                console_log("BACKEND", &sanitized);
            }
            if let Ok(mut buf) = stderr_accum_for_thread.lock() {
                if buf.len() < STDERR_CAP {
                    buf.push_str(&line);
                    buf.push('\n');
                }
            }

            if let Some(rest) = line.strip_prefix("PROGRESS|") {
                let mut parts = rest.splitn(2, '|');
                let p_str = parts.next().unwrap_or("");
                let msg = parts.next().unwrap_or("").to_string();

                if let Ok(p) = p_str.parse::<u8>() {
                    let _ = app_for_thread.emit(
                        "scene_progress",
                        ProgressPayload {
                            percent: p,
                            message: msg,
                        },
                    );
                }
            }
        }
    });

    let stdout_string = tokio::task::spawn_blocking(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        reader.read_to_string(&mut buf).map(|_| buf)
    })
    .await
    .map_err(|e| format!("stdout thread panicked: {e}"))?
    .map_err(|e| format!("Failed reading stdout: {e}"))?;

    let _ = stderr_handle.await;

    let status = tokio::task::spawn_blocking(move || child.wait())
        .await
        .map_err(|e| format!("wait thread panicked: {e}"))?
        .map_err(|e| format!("Failed waiting for python: {e}"))?;

    // Clear tracked PID now that the process has exited.
    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = None;
    }

    console_log(
        "SCENE|end",
        &format!("video={video_name} status={}", status),
    );

    if !status.success() {
        let err = stderr_accum
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| "Python failed (stderr lock poisoned)".to_string());

        console_log(
            "ERROR|detect_scenes",
            &format!("video={video_name} exit={status}"),
        );
        console_log("ERROR|detect_scenes", "backend_stderr_dump_begin");
        for l in err.lines() {
            let sanitized = sanitize_line_with_known_paths(
                l,
                &video_path,
                &video_name,
                &output_dir_str,
                &output_dir_base,
            );
            if !sanitized.trim().is_empty() && !sanitized.starts_with("PROGRESS|") {
                console_log("BACKEND", &sanitized);
            }
        }
        console_log("ERROR|detect_scenes", "backend_stderr_dump_end");
        return Err(err);
    }

    Ok(stdout_string)
}

// ============================================================================
// Commands: abort scene detection
// ============================================================================

#[tauri::command]
async fn abort_detect_scenes(sidecar_state: State<'_, ActiveSidecar>) -> Result<(), String> {
    let pid = {
        let mut lock = sidecar_state.pid.lock().map_err(|e| e.to_string())?;
        lock.take()
    };

    let Some(pid) = pid else {
        console_log("ABORT", "no active sidecar to kill");
        return Ok(());
    };

    console_log("ABORT", &format!("killing process tree pid={pid}"));

    // taskkill /F /T kills the entire process tree (sidecar + ffmpeg children).
    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("taskkill");
        apply_no_window(&mut cmd);
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]).output()
    })
    .await
    .map_err(|e| format!("taskkill task panicked: {e}"))?
    .map_err(|e| format!("Failed to run taskkill: {e}"))?;

    if result.status.success() {
        console_log("ABORT", &format!("killed pid={pid} ok"));
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        console_log("ABORT", &format!("taskkill pid={pid} failed: {stderr}"));
    }

    Ok(())
}

// ============================================================================
// Commands: episode cache cleanup
// ============================================================================

#[tauri::command]
async fn delete_episode_cache(app: AppHandle, episode_cache_id: String) -> Result<(), String> {
    let id = sanitize_episode_cache_id(&episode_cache_id)?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let episode_dir = app_data_dir.join("episodes").join(id);
    if episode_dir.exists() {
        std::fs::remove_dir_all(&episode_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn clear_episode_panel_cache(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let episodes_dir = app_data_dir.join("episodes");

    if episodes_dir.exists() {
        std::fs::remove_dir_all(&episodes_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn probe_source_video_meta(
    ffprobe: PathBuf,
    source_path: String,
) -> Result<SourceVideoMeta, String> {
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        cmd.args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels",
            "-of",
            "json",
            &source_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe failed while probing source media".to_string()
        } else {
            format!("ffprobe failed while probing source media: {stderr}")
        });
    }

    let root: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe JSON parse failed: {e}"))?;

    let streams = root
        .get("streams")
        .and_then(|v| v.as_array())
        .ok_or("ffprobe output missing streams")?;

    let video = streams
        .iter()
        .find(|v| v.get("codec_type").and_then(|x| x.as_str()) == Some("video"))
        .ok_or("No video stream found in source media")?;

    let audio = streams
        .iter()
        .find(|v| v.get("codec_type").and_then(|x| x.as_str()) == Some("audio"));

    let fps_ratio = parse_ffprobe_ratio(video.get("avg_frame_rate").and_then(|v| v.as_str()))
        .or_else(|| parse_ffprobe_ratio(video.get("r_frame_rate").and_then(|v| v.as_str())))
        .unwrap_or((30, 1));

    let fps_num = fps_ratio.0.max(1);
    let fps_den = fps_ratio.1.max(1);
    let fps = f64::from(fps_num) / f64::from(fps_den);
    let (timebase, ntsc) = classify_timebase_ntsc(fps);

    let width = parse_ffprobe_u32(video.get("width")).unwrap_or(1920).max(1);
    let height = parse_ffprobe_u32(video.get("height"))
        .unwrap_or(1080)
        .max(1);

    let duration_sec = root
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(0.0);

    let audio_sample_rate =
        parse_ffprobe_u32(audio.and_then(|a| a.get("sample_rate"))).unwrap_or(48000);
    let audio_channels = parse_ffprobe_u32(audio.and_then(|a| a.get("channels")))
        .unwrap_or(2)
        .max(1);

    Ok(SourceVideoMeta {
        fps_num,
        fps_den,
        timebase,
        ntsc,
        width,
        height,
        duration_sec,
        audio_sample_rate,
        audio_channels,
    })
}

// ============================================================================
// Commands: export clips
// ============================================================================

#[tauri::command]
async fn export_clips(
    app: AppHandle,
    clips: Vec<String>,
    save_path: String,
    merge_enabled: bool,
) -> Result<(), String> {
    if clips.is_empty() {
        return Ok(());
    }

    console_log(
        "EXPORT|start",
        &format!(
            "merge_enabled={} clips={} dest={}",
            merge_enabled,
            clips.len(),
            file_name_only(&save_path)
        ),
    );

    // Export uses FFmpeg.
    // - merge_enabled: prefer concat demuxer + stream copy (fast), with fallback to re-encode for compatibility
    // - else: per-clip export prefers stream copy when already AE-friendly, else re-encodes for compatibility
    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;

    let mut save_path = PathBuf::from(&save_path);
    let export_start_time = Instant::now();

    // If the user gave a path without an extension (or a template-ish name), default to mp4.
    if save_path.extension().is_none() {
        save_path.set_extension("mp4");
    }

    // Ensure destination directory exists for both merge and multi-export.
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    fn format_elapsed(start_time: Instant) -> String {
        let secs = start_time.elapsed().as_secs();
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;

        if h > 0 {
            format!("{:02}:{:02}:{:02}", h, m, s)
        } else {
            format!("{:02}:{:02}", m, s)
        }
    }

    fn emit_export_progress(app: &AppHandle, percent: u8, message: &str, start_time: Instant) {
        let p = percent.min(100);
        let msg = format!(
            "{} ({} elapsed)",
            message.replace('\n', " ").replace('\r', " "),
            format_elapsed(start_time)
        );

        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: p,
                message: msg,
            },
        );
    }

    async fn ffprobe_duration_ms(ffprobe: PathBuf, path: String) -> Result<Option<u64>, String> {
        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&ffprobe);
            apply_no_window(&mut cmd);
            let out = cmd
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=nk=1:nw=1",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

            if !out.status.success() {
                return Ok(None);
            }

            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                return Ok(None);
            }

            let secs: f64 = s
                .parse()
                .map_err(|_| "ffprobe duration parse failed".to_string())?;
            if !secs.is_finite() || secs <= 0.0 {
                return Ok(None);
            }
            Ok(Some((secs * 1000.0).round() as u64))
        })
        .await
        .map_err(|e| format!("ffprobe task panicked: {e}"))?
    }

    async fn ffprobe_codec_name(
        ffprobe: PathBuf,
        path: String,
        stream_selector: &'static str,
    ) -> Result<Option<String>, String> {
        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&ffprobe);
            apply_no_window(&mut cmd);
            let out = cmd
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    stream_selector,
                    "-show_entries",
                    "stream=codec_name",
                    "-of",
                    "default=nk=1:nw=1",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

            if !out.status.success() {
                return Ok(None);
            }

            let s = String::from_utf8_lossy(&out.stdout)
                .trim()
                .to_ascii_lowercase();
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(s))
            }
        })
        .await
        .map_err(|e| format!("ffprobe task panicked: {e}"))?
    }

    async fn is_ae_copy_safe(ffprobe: PathBuf, clip_path: String) -> Result<bool, String> {
        // "Safe" here means: if we stream-copy, AE is likely to import.
        // We keep it conservative: H.264 video and AAC-or-no-audio.
        let v = ffprobe_codec_name(ffprobe.clone(), clip_path.clone(), "v:0").await?;
        if v.as_deref() != Some("h264") {
            return Ok(false);
        }
        let a = ffprobe_codec_name(ffprobe, clip_path, "a:0").await?;
        Ok(a.is_none() || a.as_deref() == Some("aac"))
    }

    fn run_ffmpeg_with_progress(
        app: AppHandle,
        ffmpeg: PathBuf,
        mut args: Vec<String>,
        total_ms: Option<u64>,
        completed_ms: u64,
        grand_total_ms: Option<u64>,
        message_prefix: &str,
        start_time: Instant,
    ) -> Result<(), String> {
        // Force progress to stderr so we can parse it (while still receiving real errors).
        // Note: ffmpeg writes key=value lines like out_time_ms=..., progress=continue/end.
        args.insert(0, "-hide_banner".into());
        args.insert(0, "-nostats".into());
        args.insert(0, "pipe:2".into());
        args.insert(0, "-progress".into());

        let mut cmd = Command::new(&ffmpeg);
        apply_no_window(&mut cmd);
        let mut child = cmd
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg ({}): {e}", ffmpeg.display()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture ffmpeg stderr")?;
        let reader = BufReader::new(stderr);

        let mut stderr_accum = String::new();
        let mut last_emit = Instant::now() - Duration::from_secs(5);
        let mut last_percent: Option<u8> = None;

        for line in reader.lines().flatten() {
            stderr_accum.push_str(&line);
            stderr_accum.push('\n');

            let line_trim = line.trim();
            if let Some(v) = line_trim.strip_prefix("out_time_ms=") {
                if let Ok(_out_ms) = v.parse::<u64>() {
                    // Show elapsed time since start
                    let elapsed = start_time.elapsed();
                    let secs = elapsed.as_secs();
                    let h = secs / 3600;
                    let m = (secs % 3600) / 60;
                    let s = secs % 60;
                    let elapsed_str = if h > 0 {
                        format!("{:02}:{:02}:{:02}", h, m, s)
                    } else {
                        format!("{:02}:{:02}", m, s)
                    };
                    let progress_msg = format!("{message_prefix} ({} elapsed)", elapsed_str);

                    // percent is still calculated for the progress bar
                    let denom_ms = grand_total_ms.or(total_ms).unwrap_or(0);
                    let overall_ms =
                        completed_ms.saturating_add(_out_ms.min(total_ms.unwrap_or(_out_ms)));
                    let mut percent = if denom_ms > 0 {
                        ((overall_ms as f64 / denom_ms as f64) * 100.0).floor() as i32
                    } else {
                        0
                    };
                    percent = percent.clamp(0, 99);
                    let p = percent as u8;

                    let should_emit =
                        last_percent != Some(p) || last_emit.elapsed() > Duration::from_secs(1);

                    if should_emit {
                        last_emit = Instant::now();
                        last_percent = Some(p);

                        let _ = app.emit(
                            "scene_progress",
                            ProgressPayload {
                                percent: p,
                                message: progress_msg,
                            },
                        );
                    }
                }
            }

            if line_trim == "progress=end" {
                break;
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;

        if !status.success() {
            // On failure, dump ffmpeg stderr to console (screenshot-friendly).
            let mut err = stderr_accum.clone();

            // Best-effort redact input/output paths down to filenames.
            let mut inputs: Vec<String> = Vec::new();
            for i in 0..args.len().saturating_sub(1) {
                if args[i] == "-i" {
                    inputs.push(args[i + 1].clone());
                }
            }
            let output = args.last().cloned();
            for p in inputs.into_iter().chain(output.into_iter()) {
                let base = file_name_only(&p);
                if !p.is_empty() && p != base {
                    err = err.replace(&p, &base);
                }
            }

            console_log(
                "FFMPEG|failed",
                &format!("{} status={}", ffmpeg.display(), status),
            );
            for l in err.lines() {
                if !l.trim().is_empty() {
                    console_log("FFMPEG", l);
                }
            }

            let err = err.trim().to_string();
            return Err(if err.is_empty() {
                format!("FFmpeg failed ({})", ffmpeg.display())
            } else {
                err
            });
        }

        // Successful run; emit a small step forward (caller may emit 100 at the end).
        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: 80,
                message: format!("{message_prefix}"),
            },
        );

        Ok(())
    }

    fn ffmpeg_reencode_ae_args(input: &str, output: &str) -> Vec<String> {
        // Timestamp normalization + re-encode to broadly compatible H.264/AAC MP4.
        // This avoids common NLE import issues (black frames, odd timebases, missing PTS).
        vec![
            "-y",
            "-i",
            input,
            "-fflags",
            "+genpts",
            "-avoid_negative_ts",
            "make_zero",
            // Video
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "high",
            "-level",
            "4.1",
            "-preset",
            "medium",
            "-crf",
            "18",
            // Audio
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            // MP4 faststart
            "-movflags",
            "+faststart",
            // Avoid rare muxing queue overflows on tricky inputs.
            "-max_muxing_queue_size",
            "1024",
            output,
        ]
        .into_iter()
        .map(|s| s.to_string())
        .collect()
    }

    if merge_enabled {
        // ---------------- MERGE ----------------

        use std::io::Write;
        use tempfile::NamedTempFile;

        emit_export_progress(&app, 0, "Merging clips...", export_start_time);

        let out_str = save_path.to_str().ok_or("Invalid output path")?.to_string();

        // Best-effort total duration for progress.
        emit_export_progress(&app, 25, "Probing durations...", export_start_time);
        let mut total_ms: Option<u64> = Some(0);
        for c in &clips {
            match ffprobe_duration_ms(ffprobe.clone(), c.clone()).await {
                Ok(Some(ms)) => {
                    if let Some(t) = total_ms {
                        total_ms = Some(t.saturating_add(ms));
                    }
                }
                _ => {
                    total_ms = None;
                    break;
                }
            }
        }

        // Write file list for ffmpeg concat demuxer
        emit_export_progress(&app, 40, "Preparing file list...", export_start_time);
        let mut filelist =
            NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;
        for c in &clips {
            // ffmpeg concat demuxer requires each line: file 'path'
            // Escape single quotes in paths
            let safe_path = c.replace("'", "'\\''");
            writeln!(filelist, "file '{}'", safe_path)
                .map_err(|e| format!("Failed to write to temp file: {e}"))?;
        }
        let filelist_path = filelist.path().to_string_lossy().to_string();

        emit_export_progress(&app, 50, "Merging...", export_start_time);

        let args = vec![
            "-y".into(),
            "-f".into(),
            "concat".into(),
            "-safe".into(),
            "0".into(),
            "-i".into(),
            filelist_path.clone(),
            // Video/audio re-encode for compatibility
            "-fflags".into(),
            "+genpts".into(),
            "-avoid_negative_ts".into(),
            "make_zero".into(),
            "-c:v".into(),
            "libx264".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-profile:v".into(),
            "high".into(),
            "-level".into(),
            "4.1".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "18".into(),
            "-movflags".into(),
            "+faststart".into(),
            "-max_muxing_queue_size".into(),
            "1024".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
            out_str.clone(),
        ];

        let app_for_ffmpeg = app.clone();
        let ffmpeg_clone = ffmpeg.clone();
        let total_ms_f = total_ms;
        let start_time = export_start_time;
        let out = tokio::task::spawn_blocking(move || {
            run_ffmpeg_with_progress(
                app_for_ffmpeg,
                ffmpeg_clone,
                args,
                total_ms_f,
                0,
                total_ms_f,
                "Merging",
                start_time,
            )
        })
        .await
        .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

        if let Err(e) = out {
            console_log(
                "ERROR|export_clips",
                &format!("merge failed: {}", sanitize_for_console(&e)),
            );
            return Err(format!("FFmpeg merge failed: {e}"));
        }

        emit_export_progress(&app, 100, "Export complete", export_start_time);
    } else {
        // ---------------- MULTIPLE EXPORT ----------------

        // In merge-disabled mode, the frontend passes a *file path* chosen via a Save dialog.
        // We treat it as a naming template: <user_stem>_<clip_code>.<ext>
        let destination_dir = save_path.parent().ok_or("Invalid save path")?;
        let user_stem = save_path
            .file_stem()
            .ok_or("Invalid filename")?
            .to_string_lossy()
            .to_string();

        let ext = save_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4")
            .to_string();

        // Probe durations once to produce smooth overall progress.
        emit_export_progress(&app, 5, "Probing clip info...", export_start_time);
        let mut per_ms: Vec<Option<u64>> = Vec::with_capacity(clips.len());
        let mut total_ms: Option<u64> = Some(0);
        // Pre-cache codec info alongside durations to avoid redundant ffprobe calls per clip.
        let mut per_copy_safe: Vec<bool> = Vec::with_capacity(clips.len());
        for c in &clips {
            let d = ffprobe_duration_ms(ffprobe.clone(), c.clone())
                .await
                .ok()
                .flatten();
            per_ms.push(d);
            if let (Some(t), Some(ms)) = (total_ms, d) {
                total_ms = Some(t.saturating_add(ms));
            } else {
                total_ms = None;
            }
            let safe = is_ae_copy_safe(ffprobe.clone(), c.clone())
                .await
                .unwrap_or(false);
            per_copy_safe.push(safe);
        }

        let mut done_ms: u64 = 0;
        for (i, clip) in clips.iter().enumerate() {
            let clip_path = Path::new(clip);
            let clip_stem = clip_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");

            let clip_code = clip_stem
                .rsplit('_')
                .next()
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| "0000");

            // If the code isn't purely digits (unexpected naming), fall back to index.
            let code = if clip_code.chars().all(|c| c.is_ascii_digit()) {
                clip_code.to_string()
            } else {
                format!("{:04}", i)
            };

            // Support the frontend's `####` placeholder: `base_####.mp4` -> `base_0001.mp4`.
            // If not present, fall back to `base_<code>.mp4`.
            let file_stem = if user_stem.contains("####") {
                user_stem.replace("####", &code)
            } else {
                format!("{}_{}", user_stem, code)
            };

            let destination = destination_dir.join(format!("{}.{}", file_stem, ext));

            let input_str = clip_path.to_str().ok_or("Invalid clip path")?;
            let output_str = destination.to_str().ok_or("Invalid destination path")?;

            let msg = format!("Exporting clip {}/{}", i + 1, clips.len());
            emit_export_progress(&app, 10, &msg, export_start_time);

            // Use pre-cached codec info instead of re-probing each clip.
            let copy_ok = per_copy_safe.get(i).copied().unwrap_or(false);
            let clip_total = per_ms.get(i).copied().flatten();

            let (mode_msg, args) = if copy_ok {
                (
                    format!("{msg} (copy)"),
                    vec![
                        "-y".into(),
                        "-i".into(),
                        input_str.into(),
                        "-fflags".into(),
                        "+genpts".into(),
                        "-avoid_negative_ts".into(),
                        "make_zero".into(),
                        "-c".into(),
                        "copy".into(),
                        "-movflags".into(),
                        "+faststart".into(),
                        output_str.into(),
                    ],
                )
            } else {
                (
                    format!("{msg} (re-encode)"),
                    ffmpeg_reencode_ae_args(input_str, output_str),
                )
            };

            console_log(
                "EXPORT|clip",
                &format!(
                    "{}/{} input={} output={} mode={}",
                    i + 1,
                    clips.len(),
                    file_name_only(input_str),
                    file_name_only(output_str),
                    if copy_ok { "copy" } else { "re-encode" }
                ),
            );

            let app_for_ffmpeg = app.clone();
            let ffmpeg_clone = ffmpeg.clone();
            let grand_total = total_ms;
            let done_before = done_ms;
            let run_msg = mode_msg.clone();
            let run_args = args;
            let start_time = export_start_time;
            let result = tokio::task::spawn_blocking(move || {
                run_ffmpeg_with_progress(
                    app_for_ffmpeg,
                    ffmpeg_clone,
                    run_args,
                    clip_total,
                    done_before,
                    grand_total,
                    &run_msg,
                    start_time,
                )
            })
            .await
            .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

            if let Err(e) = result {
                // If copy failed, retry re-encode automatically.
                if copy_ok {
                    console_log(
                        "EXPORT|retry",
                        &format!(
                            "clip {}/{} stream copy failed; retry re-encode (input={} output={})",
                            i + 1,
                            clips.len(),
                            file_name_only(input_str),
                            file_name_only(output_str)
                        ),
                    );
                    emit_export_progress(
                        &app,
                        15,
                        "Stream copy failed; re-encoding...",
                        export_start_time,
                    );
                    let app_for_ffmpeg = app.clone();
                    let ffmpeg_clone = ffmpeg.clone();
                    let grand_total = total_ms;
                    let done_before = done_ms;
                    let run_msg = format!("{msg} (re-encode)");
                    let run_args = ffmpeg_reencode_ae_args(input_str, output_str);
                    let start_time = export_start_time;
                    let result2 = tokio::task::spawn_blocking(move || {
                        run_ffmpeg_with_progress(
                            app_for_ffmpeg,
                            ffmpeg_clone,
                            run_args,
                            clip_total,
                            done_before,
                            grand_total,
                            &run_msg,
                            start_time,
                        )
                    })
                    .await
                    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;
                    if let Err(e2) = result2 {
                        console_log(
                            "ERROR|export_clips",
                            &format!(
                                "export failed clip {}/{} input={} output={}",
                                i + 1,
                                clips.len(),
                                file_name_only(input_str),
                                file_name_only(output_str)
                            ),
                        );
                        return Err(format!(
                            "FFmpeg export failed.\n(copy)\n{e}\n\n(re-encode)\n{e2}"
                        ));
                    }
                } else {
                    console_log(
                        "ERROR|export_clips",
                        &format!(
                            "export failed clip {}/{} input={} output={}",
                            i + 1,
                            clips.len(),
                            file_name_only(input_str),
                            file_name_only(output_str)
                        ),
                    );
                    return Err(format!("FFmpeg export failed: {e}"));
                }
            }

            if let Some(ms) = clip_total {
                done_ms = done_ms.saturating_add(ms);
            }
        }

        emit_export_progress(&app, 100, "Export complete", export_start_time);
    }

    console_log("EXPORT|end", "ok");

    Ok(())
}

#[tauri::command]
async fn export_timeline_xml(
    app: AppHandle,
    clips: Vec<TimelineXmlClip>,
    save_path: String,
    sequence_name: Option<String>,
) -> Result<(), String> {
    if clips.is_empty() {
        return Err("No clips selected for XML export".to_string());
    }

    let _ = app.emit(
        "scene_progress",
        ProgressPayload {
            percent: 5,
            message: "Generating XML timeline...".to_string(),
        },
    );

    let first = clips.first().ok_or("No clips selected for XML export")?;
    let original_path = first
        .original_path
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or("Missing original media path in clip metadata. Re-import the episode and retry XML export.")?
        .to_string();

    for clip in &clips {
        if let Some(candidate) = clip
            .original_path
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            if candidate != original_path {
                return Err(
                    "Selected clips do not reference the same original media file".to_string(),
                );
            }
        }
    }

    let source_path = PathBuf::from(&original_path);
    if !source_path.exists() {
        return Err(format!(
            "Original media file no longer exists: {}",
            source_path.display()
        ));
    }

    let mut output_path = PathBuf::from(&save_path);
    if output_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| !e.eq_ignore_ascii_case("xml"))
        .unwrap_or(true)
    {
        output_path.set_extension("xml");
    }

    if let Some(parent) = output_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    let source_meta = probe_source_video_meta(ffprobe, original_path.clone()).await?;

    let mut ordered = clips;
    ordered.sort_by(|a, b| {
        a.scene_index
            .unwrap_or(u32::MAX)
            .cmp(&b.scene_index.unwrap_or(u32::MAX))
            .then_with(|| {
                let left = a.start_sec.unwrap_or(f64::INFINITY);
                let right = b.start_sec.unwrap_or(f64::INFINITY);
                left.partial_cmp(&right)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.src.cmp(&b.src))
            .then_with(|| a.id.cmp(&b.id))
    });

    let fps = f64::from(source_meta.fps_num) / f64::from(source_meta.fps_den);
    let mut timeline_cursor = 0_i64;
    let mut segments: Vec<TimelineClipSegment> = Vec::with_capacity(ordered.len());

    for (idx, clip) in ordered.iter().enumerate() {
        let start_sec = clip.start_sec.ok_or(
            "Clip cut metadata is incomplete. Re-import this episode before exporting XML.",
        )?;

        let next_start = ordered.get(idx + 1).and_then(|c| c.start_sec);
        let mut end_sec = clip
            .end_sec
            .or(next_start)
            .unwrap_or(source_meta.duration_sec);

        if !end_sec.is_finite() || end_sec <= start_sec {
            end_sec = start_sec + (1.0 / fps.max(1.0));
        }

        if source_meta.duration_sec > 0.0 {
            end_sec = end_sec.min(source_meta.duration_sec);
        }

        let source_in = seconds_to_frames(start_sec, source_meta.fps_num, source_meta.fps_den);
        let mut source_out = seconds_to_frames(end_sec, source_meta.fps_num, source_meta.fps_den);
        if source_out <= source_in {
            source_out = source_in + 1;
        }

        let duration = source_out - source_in;
        let timeline_start = timeline_cursor;
        let timeline_end = timeline_start + duration;
        timeline_cursor = timeline_end;

        let name = clip
            .original_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .unwrap_or_else(|| file_name_only(&clip.src));

        segments.push(TimelineClipSegment {
            name,
            source_in,
            source_out,
            timeline_start,
            timeline_end,
        });
    }

    if segments.is_empty() {
        return Err("No valid segments could be built for XML export".to_string());
    }

    let sequence_duration = timeline_cursor.max(1);
    let source_total_frames = if source_meta.duration_sec > 0.0 {
        seconds_to_frames(
            source_meta.duration_sec,
            source_meta.fps_num,
            source_meta.fps_den,
        )
        .max(1)
    } else {
        segments
            .iter()
            .map(|s| s.source_out)
            .max()
            .unwrap_or(1)
            .max(1)
    };

    let final_sequence_name = sequence_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .or_else(|| {
            output_path
                .file_stem()
                .and_then(|v| v.to_str())
                .map(|v| v.to_string())
        })
        .unwrap_or_else(|| "AMVerge XML Timeline".to_string());

    let escaped_sequence_name = xml_escape(&final_sequence_name);
    let escaped_source_name = xml_escape(
        source_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("source"),
    );
    let source_url = xml_escape(&path_to_file_url(&source_path));
    let ntsc = if source_meta.ntsc { "TRUE" } else { "FALSE" };
    let reported_audio_channels = source_meta.audio_channels.max(1);
    let audio_layout = if reported_audio_channels == 1 {
        "mono"
    } else {
        "stereo"
    };

    let mut shared_file_block = String::new();
    shared_file_block.push_str("            <file id=\"file-1\">\n");
    shared_file_block.push_str(&format!(
        "              <name>{}</name>\n",
        escaped_source_name
    ));
    shared_file_block.push_str(&format!(
        "              <pathurl>{}</pathurl>\n",
        source_url
    ));
    shared_file_block.push_str("              <rate>\n");
    shared_file_block.push_str(&format!(
        "                <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    shared_file_block.push_str(&format!("                <ntsc>{}</ntsc>\n", ntsc));
    shared_file_block.push_str("              </rate>\n");
    shared_file_block.push_str(&format!(
        "              <duration>{}</duration>\n",
        source_total_frames
    ));
    shared_file_block.push_str("              <timecode>\n");
    shared_file_block.push_str("                <rate>\n");
    shared_file_block.push_str(&format!(
        "                  <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    shared_file_block.push_str(&format!("                  <ntsc>{}</ntsc>\n", ntsc));
    shared_file_block.push_str("                </rate>\n");
    shared_file_block.push_str("                <string>00:00:00:00</string>\n");
    shared_file_block.push_str("                <frame>0</frame>\n");
    shared_file_block.push_str("                <displayformat>NDF</displayformat>\n");
    shared_file_block.push_str("              </timecode>\n");
    shared_file_block.push_str("              <media>\n");
    shared_file_block.push_str("                <video>\n");
    shared_file_block.push_str("                  <samplecharacteristics>\n");
    shared_file_block.push_str("                    <rate>\n");
    shared_file_block.push_str(&format!(
        "                      <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    shared_file_block.push_str(&format!("                      <ntsc>{}</ntsc>\n", ntsc));
    shared_file_block.push_str("                    </rate>\n");
    shared_file_block.push_str(&format!(
        "                    <width>{}</width>\n",
        source_meta.width
    ));
    shared_file_block.push_str(&format!(
        "                    <height>{}</height>\n",
        source_meta.height
    ));
    shared_file_block.push_str("                    <pixelaspectratio>square</pixelaspectratio>\n");
    shared_file_block.push_str("                    <fielddominance>none</fielddominance>\n");
    shared_file_block.push_str("                  </samplecharacteristics>\n");
    shared_file_block.push_str("                </video>\n");
    shared_file_block.push_str("                <audio>\n");
    shared_file_block.push_str("                  <samplecharacteristics>\n");
    shared_file_block.push_str("                    <depth>16</depth>\n");
    shared_file_block.push_str(&format!(
        "                    <samplerate>{}</samplerate>\n",
        source_meta.audio_sample_rate
    ));
    shared_file_block.push_str("                  </samplecharacteristics>\n");
    shared_file_block.push_str(&format!(
        "                  <channelcount>{}</channelcount>\n",
        source_meta.audio_channels
    ));
    shared_file_block.push_str(&format!(
        "                  <layout>{}</layout>\n",
        audio_layout
    ));
    for ch in 1..=reported_audio_channels {
        shared_file_block.push_str("                  <audiochannel>\n");
        shared_file_block.push_str(&format!(
            "                    <sourcechannel>{}</sourcechannel>\n",
            ch
        ));
        let label = match ch {
            1 => "left",
            2 => "right",
            _ => "mono",
        };
        shared_file_block.push_str(&format!(
            "                    <channellabel>{}</channellabel>\n",
            label
        ));
        shared_file_block.push_str("                  </audiochannel>\n");
    }
    shared_file_block.push_str("                </audio>\n");
    shared_file_block.push_str("              </media>\n");
    shared_file_block.push_str("            </file>\n");

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<!DOCTYPE xmeml>\n");
    xml.push_str("<xmeml version=\"5\">\n");
    xml.push_str("  <sequence>\n");
    xml.push_str(&format!("    <name>{}</name>\n", escaped_sequence_name));
    xml.push_str("    <rate>\n");
    xml.push_str(&format!(
        "      <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    xml.push_str(&format!("      <ntsc>{}</ntsc>\n", ntsc));
    xml.push_str("    </rate>\n");
    xml.push_str(&format!("    <duration>{}</duration>\n", sequence_duration));
    xml.push_str("    <media>\n");
    xml.push_str("      <video>\n");
    xml.push_str("        <format>\n");
    xml.push_str("          <samplecharacteristics>\n");
    xml.push_str("            <rate>\n");
    xml.push_str(&format!(
        "              <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    xml.push_str(&format!("              <ntsc>{}</ntsc>\n", ntsc));
    xml.push_str("            </rate>\n");
    xml.push_str(&format!(
        "            <width>{}</width>\n",
        source_meta.width
    ));
    xml.push_str(&format!(
        "            <height>{}</height>\n",
        source_meta.height
    ));
    xml.push_str("            <pixelaspectratio>square</pixelaspectratio>\n");
    xml.push_str("            <fielddominance>none</fielddominance>\n");
    xml.push_str("          </samplecharacteristics>\n");
    xml.push_str("        </format>\n");
    xml.push_str("        <track>\n");
    xml.push_str("          <enabled>TRUE</enabled>\n");
    xml.push_str("          <locked>FALSE</locked>\n");

    for (idx, segment) in segments.iter().enumerate() {
        let clip_ordinal = idx + 1;
        let video_clip_id = format!("clipitem-v-{clip_ordinal}");
        let audio_clip_id = format!("clipitem-a-{clip_ordinal}");
        let clip_name = xml_escape(&segment.name);
        let clip_duration = (segment.timeline_end - segment.timeline_start).max(1);
        xml.push_str(&format!("          <clipitem id=\"{}\">\n", video_clip_id));
        xml.push_str(&format!("            <name>{}</name>\n", clip_name));
        xml.push_str("            <enabled>TRUE</enabled>\n");
        xml.push_str("            <rate>\n");
        xml.push_str(&format!(
            "              <timebase>{}</timebase>\n",
            source_meta.timebase
        ));
        xml.push_str(&format!("              <ntsc>{}</ntsc>\n", ntsc));
        xml.push_str("            </rate>\n");
        xml.push_str(&format!(
            "            <start>{}</start>\n",
            segment.timeline_start
        ));
        xml.push_str(&format!(
            "            <end>{}</end>\n",
            segment.timeline_end
        ));
        xml.push_str(&format!(
            "            <duration>{}</duration>\n",
            clip_duration
        ));
        xml.push_str(&format!("            <in>{}</in>\n", segment.source_in));
        xml.push_str(&format!("            <out>{}</out>\n", segment.source_out));

        if idx == 0 {
            xml.push_str(&shared_file_block);
        } else {
            xml.push_str("            <file id=\"file-1\"/>\n");
        }

        xml.push_str("            <sourcetrack>\n");
        xml.push_str("              <mediatype>video</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str("            </sourcetrack>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            video_clip_id
        ));
        xml.push_str("              <mediatype>video</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("            </link>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            audio_clip_id
        ));
        xml.push_str("              <mediatype>audio</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("              <groupindex>1</groupindex>\n");
        xml.push_str("            </link>\n");
        xml.push_str("          </clipitem>\n");
    }

    xml.push_str("        </track>\n");
    xml.push_str("      </video>\n");
    xml.push_str("      <audio>\n");
    xml.push_str("        <format>\n");
    xml.push_str("          <samplecharacteristics>\n");
    xml.push_str("            <depth>16</depth>\n");
    xml.push_str(&format!(
        "            <samplerate>{}</samplerate>\n",
        source_meta.audio_sample_rate
    ));
    xml.push_str("          </samplecharacteristics>\n");
    xml.push_str(&format!(
        "          <channelcount>{}</channelcount>\n",
        source_meta.audio_channels
    ));
    xml.push_str(&format!("          <layout>{}</layout>\n", audio_layout));
    xml.push_str("        </format>\n");
    xml.push_str("        <track>\n");
    xml.push_str("          <enabled>TRUE</enabled>\n");
    xml.push_str("          <locked>FALSE</locked>\n");

    for (idx, segment) in segments.iter().enumerate() {
        let clip_ordinal = idx + 1;
        let video_clip_id = format!("clipitem-v-{clip_ordinal}");
        let audio_clip_id = format!("clipitem-a-{clip_ordinal}");
        let clip_name = xml_escape(&segment.name);
        let clip_duration = (segment.timeline_end - segment.timeline_start).max(1);
        xml.push_str(&format!("          <clipitem id=\"{}\">\n", audio_clip_id));
        xml.push_str(&format!("            <name>{}</name>\n", clip_name));
        xml.push_str("            <enabled>TRUE</enabled>\n");
        xml.push_str("            <rate>\n");
        xml.push_str(&format!(
            "              <timebase>{}</timebase>\n",
            source_meta.timebase
        ));
        xml.push_str(&format!("              <ntsc>{}</ntsc>\n", ntsc));
        xml.push_str("            </rate>\n");
        xml.push_str(&format!(
            "            <start>{}</start>\n",
            segment.timeline_start
        ));
        xml.push_str(&format!(
            "            <end>{}</end>\n",
            segment.timeline_end
        ));
        xml.push_str(&format!(
            "            <duration>{}</duration>\n",
            clip_duration
        ));
        xml.push_str(&format!("            <in>{}</in>\n", segment.source_in));
        xml.push_str(&format!("            <out>{}</out>\n", segment.source_out));
        if idx == 0 {
            xml.push_str(&shared_file_block);
        } else {
            xml.push_str("            <file id=\"file-1\"/>\n");
        }
        xml.push_str("            <sourcetrack>\n");
        xml.push_str("              <mediatype>audio</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str("            </sourcetrack>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            video_clip_id
        ));
        xml.push_str("              <mediatype>video</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("            </link>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            audio_clip_id
        ));
        xml.push_str("              <mediatype>audio</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("              <groupindex>1</groupindex>\n");
        xml.push_str("            </link>\n");
        xml.push_str("          </clipitem>\n");
    }

    xml.push_str("        </track>\n");
    xml.push_str("      </audio>\n");
    xml.push_str("    </media>\n");
    xml.push_str("  </sequence>\n");
    xml.push_str("</xmeml>\n");

    std::fs::write(&output_path, xml).map_err(|e| format!("Failed to write XML file: {e}"))?;

    let _ = app.emit(
        "scene_progress",
        ProgressPayload {
            percent: 100,
            message: "XML export complete".to_string(),
        },
    );

    console_log(
        "EXPORT_XML|ok",
        &format!(
            "clips={} source={} output={}",
            segments.len(),
            file_name_only(&original_path),
            file_name_only(&output_path.to_string_lossy())
        ),
    );

    Ok(())
}

// ============================================================================
// Commands: preview proxy generation
// ============================================================================

#[tauri::command]
async fn hover_preview_error(
    clip_id: String,
    clip_path: String,
    error_code: Option<u16>,
) -> Result<(), String> {
    // Minimal implementation: just log. The frontend uses this to detect
    // unsupported codecs (e.g., HEVC) and we will add proxy generation later.
    let clip_id = clip_id.replace('\n', " ").replace('\r', " ");
    let clip_path = clip_path.replace('\n', " ").replace('\r', " ");
    println!(
        "hover_preview_error|clip_id={}|clip_path={}|error_code={:?}",
        clip_id, clip_path, error_code
    );

    Ok(())
}

#[tauri::command]
async fn ensure_preview_proxy(
    app: AppHandle,
    proxy_locks: State<'_, PreviewProxyLocks>,
    clip_path: String,
) -> Result<String, String> {
    // Serialize proxy generation per clip to avoid partially-written proxies being served.
    let clip_key = clip_path.clone();
    let clip_lock = {
        let mut map = proxy_locks.inner.lock().await;
        // Evict stale entries (no other task holds a reference) to prevent unbounded growth.
        map.retain(|_, v| Arc::strong_count(v) > 1);
        map.entry(clip_key.clone())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
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
        .and_then(|s| s.to_str())
        .ok_or("Invalid clip filename")?;

    let proxy_path = parent.join(format!("{stem}.preview.mp4"));
    let proxy_tmp_path = parent.join(format!("{stem}.preview.tmp.mp4"));

    // If proxy already exists and is non-empty, reuse it.
    if let Ok(meta) = std::fs::metadata(&proxy_path) {
        if meta.is_file() && meta.len() > 0 {
            return Ok(proxy_path.to_string_lossy().to_string());
        }
    }

    // Clean up any stale temp file from a previous failed/aborted run.
    let _ = std::fs::remove_file(&proxy_tmp_path);

    // Run FFmpeg in a blocking task.
    let ffmpeg_clone = ffmpeg.clone();
    let input = input_path.clone();
    let output = proxy_tmp_path.clone();

    let ffmpeg_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        cmd.args([
            "-y",
            "-i",
            input
                .to_str()
                .ok_or_else(|| "Invalid input path".to_string())?,
            // Map video and optional audio.
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            // Video: H.264
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            // Audio: AAC (best HTML5 compatibility)
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            // Make MP4 streamable
            "-movflags",
            "+faststart",
            output
                .to_str()
                .ok_or_else(|| "Invalid output path".to_string())?,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))
    })
    .await
    .map_err(|e| format!("ffmpeg task panicked: {e}"))??;

    if !ffmpeg_output.status.success() {
        let _ = std::fs::remove_file(&proxy_tmp_path);
        let mut stderr = String::from_utf8_lossy(&ffmpeg_output.stderr).to_string();

        // Best-effort redact the known input/output paths.
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

    // Verify tmp proxy exists.
    let meta = std::fs::metadata(&proxy_tmp_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&proxy_tmp_path);
        return Err("Proxy encode produced empty file".to_string());
    }

    // Atomically publish: rename tmp -> final. (On Windows, remove target first.)
    match std::fs::remove_file(&proxy_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to remove existing proxy: {e}")),
    }

    if let Err(e) = std::fs::rename(&proxy_tmp_path, &proxy_path) {
        // Fallback for any odd rename edge-case.
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

fn resolve_bundled_tool(app: &AppHandle, tool_name: &str) -> Result<PathBuf, String> {
    // Resolve a bundled tool (ffmpeg/ffprobe) across common resource paths.
    let exe_name = format!("{tool_name}.exe");

    // 1) Common bundled location: resources/bin/<tool>.exe
    if let Ok(p) = app.path().resolve(
        format!("bin/{exe_name}"),
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return Ok(p);
        }
    }

    // 2) Alternative location if only backend internal <tool> is bundled
    if let Ok(p) = app.path().resolve(
        format!("bin/backend_script-x86_64-pc-windows-msvc/_internal/{exe_name}"),
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return Ok(p);
        }
    }

    // 3) Dev fallback: walk upward looking for ./bin/<tool>.exe
    // Prefer the backend_script _internal tools (they include more codecs, e.g. software HEVC)
    // over the plain ./bin/<tool>.exe.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(mut dir) = exe.parent().map(|p| p.to_path_buf()) {
        for _ in 0..5 {
            let internal_candidate = dir
                .join("bin")
                .join("backend_script-x86_64-pc-windows-msvc")
                .join("_internal")
                .join(&exe_name);
            if internal_candidate.exists() {
                return Ok(internal_candidate);
            }

            let candidate = dir.join("bin").join(&exe_name);
            if candidate.exists() {
                return Ok(candidate);
            }
            if !dir.pop() {
                break;
            }
        }
    }

    Err(format!(
        "{exe_name} not found (looked in resources/bin, backend _internal, and dev src-tauri/bin)"
    ))
}

fn main() {
    // Keep setup small and obvious: plugins, shared state, commands, then run.
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PreviewProxyLocks::default())
        .manage(ActiveSidecar::default())
        .invoke_handler(tauri::generate_handler![
            detect_scenes,
            abort_detect_scenes,
            export_clips,
            export_timeline_xml,
            check_hevc,
            hover_preview_error,
            ensure_preview_proxy,
            delete_episode_cache,
            clear_episode_panel_cache,
            save_background_image,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
