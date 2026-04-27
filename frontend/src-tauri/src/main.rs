#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! AMVerge Tauri backend entrypoint.
//!
//! This file is the bridge between the React frontend and the Python/FFmpeg backend.
//!
//! Main responsibilities:
//! - start/abort scene detection
//! - emit progress events to the frontend
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
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::fs;
use fs_extra;

use tokio::sync::Mutex as AsyncMutex;

use serde::Serialize;
use tauri::Emitter;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Clone)]
struct ProgressPayload {
    percent: u8,
    message: String,
}

#[derive(Serialize, Clone)]
struct ConsoleLogPayload {
    source: String,
    level: String,
    message: String,
}

// ============================================================================
// Log collection helper
// ============================================================================

fn emit_console_log(app: &AppHandle, source: &str, level: &str, message: &str) {
    let message = sanitize_for_console(message);

    println!("AMVERGE|{}|{}|{}", source, level, message);

    let _ = app.emit(
        "console_log",
        ConsoleLogPayload {
            source: source.to_string(),
            level: level.to_string(),
            message,
        },
    );
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

#[tauri::command]
fn get_default_episodes_dir(app: AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("episodes");

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn move_episodes_to_new_dir(
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
    custom_path: Option<String>,
) -> Result<String, String> {
    let video_name = file_name_only(&video_path);
    
    let base_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?.join("episodes")
    };

    let output_dir = if let Some(raw_id) = episode_cache_id.as_deref() {
        let id = sanitize_episode_cache_id(raw_id)?;
        base_dir.join(id)
    } else {
        base_dir
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
    let app_for_stderr = app.clone();
    let app_for_stdout = app.clone();
    let stderr_accum_for_thread = Arc::clone(&stderr_accum);

    let stderr_handle = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines().flatten() {
            let sanitized = sanitize_for_console(&line);

            if let Ok(mut acc) = stderr_accum_for_thread.lock() {
                acc.push_str(&line);
                acc.push('\n');
            }

            // formatting from [PROGRESS|##|msg] -> [PROGRESS ##% - msg] for console
            if let Some(rest) = line.strip_prefix("PROGRESS|") {
                let mut parts = rest.splitn(2, '|');
                let p_str = parts.next().unwrap_or("");
                let msg = parts.next().unwrap_or("").to_string();

                if let Ok(p) = p_str.parse::<u8>() {
                    let _ = app_for_stderr.emit(
                        "scene_progress",
                        ProgressPayload {
                            percent: p,
                            message: msg.clone(),
                        },
                    );

                    emit_console_log(
                        &app_for_stderr,
                        "python",
                        "log",
                        &format!("PROGRESS {p}% - {msg}"),
                    );
                }
            } else {
                // if the line doesn't start ith PROGRESS|, just print raw backend log
                emit_console_log(&app_for_stderr, "python", "log", &sanitized);
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
                emit_console_log(&app_for_stdout, "python", "log", &sanitized);
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
async fn delete_episode_cache(
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
async fn clear_episode_panel_cache(app: AppHandle, custom_path: Option<String>) -> Result<(), String> {
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
                message: msg.clone(),
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
                    let overall_ms = completed_ms.saturating_add(_out_ms.min(total_ms.unwrap_or(_out_ms)));
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
        let mut filelist = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;
        for c in &clips {
            // ffmpeg concat demuxer requires each line: file 'path'
            // Escape single quotes in paths
            let safe_path = c.replace("'", "'\\''");
            writeln!(filelist, "file '{}'", safe_path).map_err(|e| format!("Failed to write to temp file: {e}"))?;
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
                    emit_export_progress(&app, 15, "Stream copy failed; re-encoding...", export_start_time);
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
            check_hevc,
            hover_preview_error,
            ensure_preview_proxy,
            delete_episode_cache,
            clear_episode_panel_cache,
            save_background_image,
            move_episodes_to_new_dir,
            get_default_episodes_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
