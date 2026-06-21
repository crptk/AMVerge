use std::io::{BufRead, BufReader, Read};
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(not(windows))]
use std::os::unix::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, State};
use serde_json::{json, Value};

use crate::payloads::{
    ClipReadyPayload, InitialClipsPayload, PairResultPayload, ProgressPayload,
    ReencodeProgressPayload, ThumbnailReadyPayload,
};
use crate::state::ActiveSidecar;
use crate::utils::logging::{
    console_log, emit_console_log, sanitize_for_console, sanitize_line_with_known_paths,
};
use crate::utils::paths::{
    clear_files_in_dir, dir_name_only, file_name_only, sanitize_episode_cache_id,
};
use crate::utils::process::apply_no_window;

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_manifest_atomic(output_dir: &Path, manifest: &Value) -> Result<PathBuf, String> {
    let manifest_path = output_dir.join("manifest.json");
    let temp_path = output_dir.join("manifest.json.tmp");
    let serialized = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;

    fs::write(&temp_path, serialized)
        .map_err(|e| format!("Failed to write temporary manifest: {e}"))?;

    fs::rename(&temp_path, &manifest_path)
        .map_err(|e| format!("Failed to finalize manifest file: {e}"))?;

    Ok(manifest_path)
}

fn build_manifest_from_backend_payload(
    backend_stdout: &str,
    video_path: &str,
    output_dir: &Path,
    episode_cache_id: Option<&str>,
    scene_detection_method: Option<&str>,
    import_method: Option<&str>,
) -> Result<Value, String> {
    let backend_payload: Value = serde_json::from_str(backend_stdout)
        .map_err(|e| format!("Backend output is not valid JSON: {e}"))?;

    let scenes = backend_payload
        .get("scenes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let scene_count = scenes.len();

    // Always derive the persisted clip list from the final scenes so the
    // manifest captures each scene's cut clip_path/clip_mode (the streamed
    // INITIAL_CLIPS_READY event intentionally carries null paths for first paint).
    let source_name = Path::new(video_path)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or(video_path)
        .to_string();

    let derived_initial_clips = scenes
        .iter()
        .enumerate()
        .map(|(idx, scene)| {
            let scene_index = scene
                .get("scene_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(idx as u64);

            let start_sec = scene
                .get("start_sec")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let end_sec = scene
                .get("end_sec")
                .and_then(|v| v.as_f64())
                .unwrap_or(start_sec);

            let clip_path = scene.get("clip_path").cloned().unwrap_or(Value::Null);
            let clip_mode = scene
                .get("clip_mode")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            json!({
                "scene_index": scene_index,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "path": video_path,
                "thumbnail": video_path,
                "original_file": source_name,
                "original_path": video_path,
                "clip_path": clip_path,
                "clip_mode": clip_mode,
            })
        })
        .collect::<Vec<Value>>();

    let manifest = json!({
        "schemaVersion": "1.0.0",
        "manifestId": format!("{}", uuid::Uuid::new_v4()),
        "createdAtUnix": now_unix_seconds(),
        "source": {
            "videoPath": video_path,
            "episodeCacheId": episode_cache_id,
            "outputDir": output_dir,
            "sceneDetectionMethod": scene_detection_method.unwrap_or("transnetv2_gpu"),
            "importMethod": import_method.unwrap_or("video_files"),
        },
        "summary": {
            "sceneCount": scene_count,
            "initialClipCount": derived_initial_clips.len(),
        },
        "initialClips": derived_initial_clips,
        "scenes": scenes,
        "backendPayload": backend_payload,
    });

    Ok(manifest)
}

/// Build a preliminary manifest from the streamed INITIAL_CLIPS_READY payload,
/// written the moment scenes are detected (before any clip is cut). Clip paths
/// are null here; the final manifest written at process end carries the real
/// cut paths/modes. Shape matches the final manifest so any early reader works.
fn build_preliminary_manifest(
    initial_clips_json: &str,
    video_path: &str,
    output_dir: &Path,
    episode_cache_id: Option<&str>,
    scene_detection_method: Option<&str>,
    import_method: Option<&str>,
) -> Result<Value, String> {
    let initial_clips: Vec<Value> = serde_json::from_str(initial_clips_json)
        .map_err(|e| format!("INITIAL_CLIPS payload is not valid JSON: {e}"))?;

    let scenes = initial_clips
        .iter()
        .map(|c| {
            json!({
                "scene_index": c.get("scene_index").cloned().unwrap_or(Value::Null),
                "start_sec": c.get("start_sec").cloned().unwrap_or(Value::Null),
                "end_sec": c.get("end_sec").cloned().unwrap_or(Value::Null),
                "clip_path": Value::Null,
                "clip_mode": "",
            })
        })
        .collect::<Vec<Value>>();

    Ok(json!({
        "schemaVersion": "1.0.0",
        "manifestId": format!("{}", uuid::Uuid::new_v4()),
        "createdAtUnix": now_unix_seconds(),
        "preliminary": true,
        "source": {
            "videoPath": video_path,
            "episodeCacheId": episode_cache_id,
            "outputDir": output_dir,
            "sceneDetectionMethod": scene_detection_method.unwrap_or("transnetv2_gpu"),
            "importMethod": import_method.unwrap_or("video_files"),
        },
        "summary": {
            "sceneCount": scenes.len(),
            "initialClipCount": initial_clips.len(),
        },
        "initialClips": initial_clips,
        "scenes": scenes,
    }))
}

#[tauri::command]
pub async fn detect_scenes(
    app: AppHandle,
    sidecar_state: State<'_, ActiveSidecar>,
    video_path: String,
    episode_cache_id: Option<String>,
    custom_path: Option<String>,
    scene_detection_method: Option<String>,
    import_method: Option<String>,
) -> Result<String, String> {
    let video_name = file_name_only(&video_path);

    let base_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
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
        let mut root = std::env::current_dir().map_err(|e| e.to_string())?;
        root.pop();
        root.pop();

        let script_path = root.join("backend").join("app.py");
        let python_path = if cfg!(windows) {
            root.join("backend")
                .join("venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            root.join("backend").join("venv").join("bin").join("python")
        };

        let python_name =
            python_path
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or(if cfg!(windows) {
                    "python.exe"
                } else {
                    "python"
                });
        console_log(
            "SCENE|spawn",
            &format!(
                "mode=dev exe={python_name} script=app.py args=[{video_name},{output_dir_base}]"
            ),
        );

        let mut cmd = Command::new(python_path);
        apply_no_window(&mut cmd);
        #[cfg(not(windows))]
        cmd.process_group(0);
        cmd.arg(script_path)
            .arg(&video_path)
            .arg(&output_dir_str)
            .arg(scene_detection_method.clone().unwrap_or_else(|| "transnetv2_gpu".to_string()))
            .arg(import_method.clone().unwrap_or_else(|| "video_files".to_string()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn python: {e}"))?
    } else {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Can't find current exe: {e}"))?
            .parent()
            .ok_or("Can't get exe directory")?
            .to_path_buf();

        let sidecar_rel = if cfg!(windows) {
            "bin/backend_script-x86_64-pc-windows-msvc/backend_script.exe"
        } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "bin/backend_script-aarch64-apple-darwin/backend_script"
        } else if cfg!(target_os = "macos") {
            "bin/backend_script-x86_64-apple-darwin/backend_script"
        } else {
            return Err("detect_scenes: unsupported platform".to_string());
        };

        let backend = app
            .path()
            .resolve(sidecar_rel, tauri::path::BaseDirectory::Resource)
            .map_err(|e| e.to_string())?;

        let backend_name =
            backend
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or(if cfg!(windows) {
                    "backend_script.exe"
                } else {
                    "backend_script"
                });
        console_log(
            "SCENE|spawn",
            &format!("mode=prod exe={backend_name} args=[{video_name},{output_dir_base}]"),
        );

        let mut cmd = Command::new(backend);
        apply_no_window(&mut cmd);
        #[cfg(not(windows))]
        cmd.process_group(0);
        cmd.current_dir(&exe_dir)
            .arg(&video_path)
            .arg(&output_dir_str)
            .arg(scene_detection_method.clone().unwrap_or_else(|| "transnetv2_gpu".to_string()))
            .arg(import_method.clone().unwrap_or_else(|| "video_files".to_string()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn backend exe: {e}"))?
    };

    let child_pid = child.id();
    console_log("SCENE|pid", &format!("pid={}", child_pid));

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = Some(child_pid);
    }
    if let Ok(mut lock) = sidecar_state.child.lock() {
        *lock = Some(child);
    }

    let stderr_accum = Arc::new(Mutex::new(String::new()));
    let app_for_stderr = app.clone();
    let app_for_stdout = app.clone();
    let stderr_accum_for_thread = Arc::clone(&stderr_accum);

    // Cloned so the stderr thread can write a preliminary manifest as soon as
    // scenes are streamed (INITIAL_CLIPS_READY), independent of the final write.
    let output_dir_for_thread = output_dir.clone();
    let video_path_for_thread = video_path.clone();
    let episode_cache_id_for_thread = episode_cache_id.clone();
    let scene_method_for_thread = scene_detection_method.clone();
    let import_method_for_thread = import_method.clone();

    let stderr_handle = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines().flatten() {
            let sanitized = sanitize_for_console(&line);

            if let Ok(mut acc) = stderr_accum_for_thread.lock() {
                acc.push_str(&line);
                acc.push('\n');
            }

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
            } else if let Some(clips_json) = line.strip_prefix("INITIAL_CLIPS_READY|") {
                let _ = app_for_stderr.emit(
                    "initial_clips_ready",
                    InitialClipsPayload { clips_json: clips_json.to_string() },
                );
                // Persist a preliminary manifest the moment scenes are known, so
                // the episode has a lookup on disk before any clip is cut.
                match build_preliminary_manifest(
                    clips_json,
                    &video_path_for_thread,
                    &output_dir_for_thread,
                    episode_cache_id_for_thread.as_deref(),
                    scene_method_for_thread.as_deref(),
                    import_method_for_thread.as_deref(),
                ) {
                    Ok(m) => {
                        let _ = write_manifest_atomic(&output_dir_for_thread, &m);
                    }
                    Err(e) => console_log(
                        "SCENE|manifest",
                        &format!("preliminary manifest skipped: {e}"),
                    ),
                }
            } else if line.trim() == "PHASE1_COMPLETE" {
                let _ = app_for_stderr.emit("phase1_complete", ());
            } else if let Some(rest) = line.strip_prefix("REENCODE_PROGRESS|") {
                // REENCODE_PROGRESS|<done>|<total>
                let parts: Vec<&str> = rest.splitn(2, '|').collect();
                if parts.len() == 2 {
                    if let (Ok(done), Ok(total)) =
                        (parts[0].trim().parse::<u32>(), parts[1].trim().parse::<u32>())
                    {
                        let _ = app_for_stderr
                            .emit("reencode_progress", ReencodeProgressPayload { done, total });
                    }
                }
            } else if let Some(pos_str) = line.strip_prefix("THUMBNAIL_READY|") {
                if let Ok(position) = pos_str.trim().parse::<u32>() {
                    let _ = app_for_stderr.emit(
                        "thumbnail_ready",
                        ThumbnailReadyPayload { position },
                    );
                }
            } else if let Some(rest) = line.strip_prefix("CLIP_READY|") {
                // CLIP_READY|<scene_index>|<clip_path>|<clip_mode>
                let parts: Vec<&str> = rest.splitn(3, '|').collect();
                if parts.len() == 3 {
                    if let Ok(scene_index) = parts[0].trim().parse::<u32>() {
                        let clip_path = parts[1].trim().to_string();
                        let _ = app_for_stderr.emit(
                            "clip_ready",
                            ClipReadyPayload {
                                scene_index,
                                clip_path: if clip_path.is_empty() {
                                    None
                                } else {
                                    Some(clip_path)
                                },
                                clip_mode: parts[2].trim().to_string(),
                            },
                        );
                    }
                }
            } else if let Some(rest) = line.strip_prefix("PAIR_RESULT|") {
                let parts: Vec<&str> = rest.splitn(3, '|').collect();
                if parts.len() == 3 {
                    if let (Ok(pos_a), Ok(pos_b)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                        let should_merge = parts[2].trim() == "1";
                        let _ = app_for_stderr.emit(
                            "pair_result",
                            PairResultPayload { pos_a, pos_b, should_merge },
                        );
                    }
                }
            } else if line.trim() == "PROCESSING_COMPLETE" {
                let _ = app_for_stderr.emit("processing_complete", ());
            } else {
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

    let child_for_wait = sidecar_state
        .child
        .lock()
        .map_err(|e| e.to_string())?
        .take();

    let Some(mut child_for_wait) = child_for_wait else {
        if let Ok(mut lock) = sidecar_state.pid.lock() {
            *lock = None;
        }
        return Err("Scene detection was canceled.".to_string());
    };

    let status = tokio::task::spawn_blocking(move || child_for_wait.wait())
        .await
        .map_err(|e| format!("wait thread panicked: {e}"))?
        .map_err(|e| format!("Failed waiting for python: {e}"))?;

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
            let is_event_line = sanitized.starts_with("PROGRESS|")
                || sanitized.starts_with("INITIAL_CLIPS_READY|")
                || sanitized.starts_with("CLIP_READY|")
                || sanitized.starts_with("THUMBNAIL_READY|")
                || sanitized.starts_with("PAIR_RESULT|")
                || sanitized.starts_with("REENCODE_PROGRESS|")
                || sanitized.trim() == "PHASE1_COMPLETE"
                || sanitized.trim() == "PROCESSING_COMPLETE";

            if !sanitized.trim().is_empty() && !is_event_line {
                emit_console_log(&app_for_stdout, "python", "log", &sanitized);
            }
        }
        console_log("ERROR|detect_scenes", "backend_stderr_dump_end");
        return Err(err);
    }

    let manifest = build_manifest_from_backend_payload(
        &stdout_string,
        &video_path,
        &output_dir,
        episode_cache_id.as_deref(),
        scene_detection_method.as_deref(),
        import_method.as_deref(),
    )?;
    let manifest_path = write_manifest_atomic(&output_dir, &manifest)?;
    console_log(
        "SCENE|manifest",
        &format!("wrote={}", manifest_path.to_string_lossy()),
    );

    Ok(stdout_string)
}

#[tauri::command]
pub async fn load_episode_manifest(
    app: AppHandle,
    episode_cache_id: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    let base_dir = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("episodes")
    };

    let id = sanitize_episode_cache_id(&episode_cache_id)?;
    let manifest_path = base_dir.join(id).join("manifest.json");

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest '{}': {e}", manifest_path.to_string_lossy()))?;

    // Validate JSON shape at read time so frontend always receives parseable content.
    let _: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Manifest is not valid JSON: {e}"))?;

    Ok(content)
}

#[tauri::command]
pub async fn abort_detect_scenes(sidecar_state: State<'_, ActiveSidecar>) -> Result<(), String> {
    let pid = sidecar_state
        .pid
        .lock()
        .map_err(|e| e.to_string())?
        .take();

    // Drop the child handle so detect_scenes' wait path sees None and exits cleanly.
    // Dropping closes the pipes but does not kill the process — the kill below does that.
    {
        let mut lock = sidecar_state.child.lock().map_err(|e| e.to_string())?;
        *lock = None;
    }

    let Some(pid) = pid else {
        console_log("ABORT", "no active sidecar to kill");
        return Ok(());
    };

    console_log("ABORT", &format!("killing process group pid={pid}"));

    #[cfg(windows)]
    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("taskkill");
        apply_no_window(&mut cmd);
        cmd.args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {e}"))
    })
    .await
    .map_err(|e| format!("taskkill task panicked: {e}"))??;

    // Use negative PID to kill the entire process group, which includes any
    // ffmpeg child processes spawned by the Python backend.
    #[cfg(not(windows))]
    let result = tokio::task::spawn_blocking(move || {
        Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output()
            .map_err(|e| format!("Failed to run kill: {e}"))
    })
    .await
    .map_err(|e| format!("kill task panicked: {e}"))??;

    if result.status.success() {
        console_log("ABORT", &format!("killed process group pid={pid} ok"));
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        console_log("ABORT", &format!("kill process group pid={pid} failed: {stderr}"));
    }

    Ok(())
}
