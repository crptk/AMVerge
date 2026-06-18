use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::collections::{BTreeSet, HashMap};
use std::time::Instant;

#[cfg(not(windows))]
use std::os::unix::process::CommandExt;

use tauri::{AppHandle, Manager, State};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::{ActiveFfmpegPids, PreviewProxyLocks};
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::paths::{file_name_only, sanitize_episode_cache_id};
use crate::utils::process::apply_no_window;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAudioStream {
    pub audio_stream_index: u32,
    pub label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneWebpJob {
    pub scene_id: String,
    pub source_path: String,
    pub start: f64,
    pub end: f64,
    pub fps: Option<u32>,
    pub episode_cache_id: Option<String>,
    pub custom_path: Option<String>,
    /// "poster" for a static first-frame image, "animated" (default) for the looping WebP.
    pub kind: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneWebpResult {
    pub scene_id: String,
    pub path: String,
    pub duration: f64,
    pub cached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneWebpBatchItem {
    pub scene_id: String,
    pub path: Option<String>,
    pub duration: Option<f64>,
    pub cached: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneWebpBatchResult {
    pub items: Vec<SceneWebpBatchItem>,
}

fn sanitize_scene_time_window(start: f64, end: f64) -> (f64, f64, f64) {
    let safe_start = if start.is_finite() { start.max(0.0) } else { 0.0 };
    let mut safe_end = if end.is_finite() { end.max(safe_start) } else { safe_start };
    if safe_end - safe_start < 0.10 {
        safe_end = safe_start + 0.10;
    }
    // Keep grid previews short for fast first paint; long scenes are expensive to encode.
    let max_preview_secs = 2.5;
    if safe_end - safe_start > max_preview_secs {
        safe_end = safe_start + max_preview_secs;
    }
    let duration = safe_end - safe_start;
    (safe_start, safe_end, duration)
}

fn sampled_offsets(size: u64, sample_len: usize) -> Vec<u64> {
    let mut offsets = BTreeSet::new();
    offsets.insert(0);

    if size > sample_len as u64 {
        offsets.insert(size.saturating_sub(sample_len as u64));
    }

    if size > (sample_len as u64) * 2 {
        let half = size / 2;
        let middle = half.saturating_sub((sample_len as u64) / 2);
        offsets.insert(middle);
    }

    offsets.into_iter().collect()
}

fn content_fingerprint(path: &Path) -> Result<String, String> {
    const SAMPLE_BYTES: usize = 1024 * 1024;

    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read source metadata '{}': {e}", path.display()))?;
    let size = metadata.len();

    let mut file = File::open(path)
        .map_err(|e| format!("Failed to open source '{}' for fingerprinting: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());

    let mut buffer = vec![0_u8; SAMPLE_BYTES];
    for offset in sampled_offsets(size, SAMPLE_BYTES) {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("Failed to seek source '{}' for fingerprinting: {e}", path.display()))?;
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read source '{}' for fingerprinting: {e}", path.display()))?;
        if read > 0 {
            hasher.update(&buffer[..read]);
        }
    }

    Ok(hex::encode(hasher.finalize()))
}

fn preview_cache_key(
    source: &Path,
    start: f64,
    end: f64,
    fps: u32,
    is_poster: bool,
) -> Result<String, String> {
    let fingerprint = content_fingerprint(source)?;
    Ok(preview_cache_key_with_fingerprint(
        &fingerprint,
        start,
        end,
        fps,
        is_poster,
    ))
}

fn preview_cache_key_with_fingerprint(
    fingerprint: &str,
    start: f64,
    end: f64,
    fps: u32,
    is_poster: bool,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(fingerprint.as_bytes());
    hasher.update(format!("{start:.3}:{end:.3}:{fps}:{}:webp_v3", if is_poster { "poster" } else { "animated" }).as_bytes());
    let digest = hex::encode(hasher.finalize());
    digest.chars().take(24).collect()
}

fn resolve_scene_webp_cache_base(
    app: &AppHandle,
    episode_cache_id: Option<&str>,
    custom_path: Option<&str>,
) -> Result<PathBuf, String> {
    let base = if let Some(raw_id) = episode_cache_id {
        let id = sanitize_episode_cache_id(raw_id)?;
        let episodes_base = if let Some(path) = custom_path {
            PathBuf::from(path)
        } else {
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("episodes")
        };
        episodes_base.join(id).join("scenes")
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("preview_webp_cache")
    };

    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create WebP cache directory '{}': {e}", base.display()))?;

    Ok(base)
}

fn scene_webp_cache_path(
    app: &AppHandle,
    source_path: &str,
    start: f64,
    end: f64,
    fps: u32,
    is_poster: bool,
    episode_cache_id: Option<&str>,
    custom_path: Option<&str>,
) -> Result<PathBuf, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err(format!("Scene source is missing or not a file: {}", source.display()));
    }
    let key = preview_cache_key(&source, start, end, fps, is_poster)?;
    let base = resolve_scene_webp_cache_base(app, episode_cache_id, custom_path)?;

    let prefix = if is_poster { "poster" } else { "scene" };
    Ok(base.join(format!("{prefix}_{key}.webp")))
}

async fn generate_scene_webp_inner(
    app: &AppHandle,
    proxy_locks: &State<'_, PreviewProxyLocks>,
    ffmpeg_pids: &State<'_, ActiveFfmpegPids>,
    scene_id: String,
    source_path: String,
    start: f64,
    end: f64,
    fps: Option<u32>,
    episode_cache_id: Option<String>,
    custom_path: Option<String>,
    kind: Option<String>,
) -> Result<SceneWebpResult, String> {
    let input_path = PathBuf::from(&source_path);
    if !input_path.exists() {
        return Err(format!("Scene source not found: {}", input_path.display()));
    }

    let is_poster = kind.as_deref() == Some("poster");
    let frame_rate = fps.unwrap_or(8).clamp(1, 24);
    let (safe_start, safe_end, duration) = sanitize_scene_time_window(start, end);
    let webp_path = scene_webp_cache_path(
        app,
        &source_path,
        safe_start,
        safe_end,
        frame_rate,
        is_poster,
        episode_cache_id.as_deref(),
        custom_path.as_deref(),
    )?;
    let webp_tmp_path = webp_path.with_extension("tmp.webp");

    let lock_key = webp_path.to_string_lossy().to_string();
    let clip_lock = {
        let mut map = proxy_locks.inner.lock().await;
        map.retain(|_, v| Arc::strong_count(v) > 1);
        map.entry(lock_key)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = clip_lock.lock().await;

    if let Ok(meta) = std::fs::metadata(&webp_path) {
        if meta.is_file() && meta.len() > 1024 {
            return Ok(SceneWebpResult {
                scene_id,
                path: webp_path.to_string_lossy().to_string(),
                duration,
                cached: true,
            });
        }
    }

    let ffmpeg = resolve_bundled_tool(app, "ffmpeg")?;
    let vf = if is_poster {
        "scale=-2:240:flags=bicubic".to_string()
    } else {
        format!("fps={frame_rate},scale=-2:240:flags=bicubic")
    };
    let _ = std::fs::remove_file(&webp_tmp_path);

    let ffmpeg_clone = ffmpeg.clone();
    let input = input_path.clone();
    let output = webp_tmp_path.clone();
    let pids = ffmpeg_pids.pids.clone();

    let ffmpeg_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        #[cfg(not(windows))]
        cmd.process_group(0);
        cmd.args([
            "-y",
            "-ss",
            &format!("{safe_start:.3}"),
        ]);
        if !is_poster {
            cmd.args(["-t", &format!("{duration:.3}")]);
        }
        cmd.arg("-i");
        cmd.arg(&input);
        if is_poster {
            cmd.args([
                "-frames:v",
                "1",
                "-an",
                "-vf",
                &vf,
                "-c:v",
                "libwebp",
                "-threads",
                "2",
                "-lossless",
                "0",
                "-compression_level",
                "4",
                "-q:v",
                "70",
            ]);
        } else {
            cmd.args([
                "-an",
                "-vf",
                &vf,
                "-c:v",
                "libwebp",
                "-threads",
                "2",
                "-lossless",
                "0",
                "-compression_level",
                "2",
                "-q:v",
                "48",
                "-loop",
                "0",
            ]);
        }
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
        let _ = std::fs::remove_file(&webp_tmp_path);
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "FFmpeg WebP generation failed".to_string()
        } else {
            format!("FFmpeg WebP generation failed: {stderr}")
        });
    }

    let meta = std::fs::metadata(&webp_tmp_path).map_err(|e| e.to_string())?;
    if meta.len() <= 1024 {
        let _ = std::fs::remove_file(&webp_tmp_path);
        return Err("WebP generation produced an invalid file".to_string());
    }

    match std::fs::remove_file(&webp_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to remove existing WebP: {e}")),
    }

    if let Err(e) = std::fs::rename(&webp_tmp_path, &webp_path) {
        std::fs::copy(&webp_tmp_path, &webp_path)
            .map_err(|copy_err| format!("Failed to publish WebP (rename={e}, copy={copy_err})"))?;
        let _ = std::fs::remove_file(&webp_tmp_path);
    }

    console_log(
        "WEBP|ready",
        &format!(
            "scene={} path={}",
            scene_id,
            file_name_only(&webp_path.to_string_lossy())
        ),
    );

    Ok(SceneWebpResult {
        scene_id,
        path: webp_path.to_string_lossy().to_string(),
        duration,
        cached: false,
    })
}

async fn run_scene_webp_job(
    app: &AppHandle,
    proxy_locks: &State<'_, PreviewProxyLocks>,
    ffmpeg_pids: &State<'_, ActiveFfmpegPids>,
    job: SceneWebpJob,
) -> Result<SceneWebpResult, String> {
    generate_scene_webp_inner(
        app,
        proxy_locks,
        ffmpeg_pids,
        job.scene_id,
        job.source_path,
        job.start,
        job.end,
        job.fps,
        job.episode_cache_id,
        job.custom_path,
        job.kind,
    )
    .await
}

fn lookup_scene_webp_cache_item(
    app: &AppHandle,
    fingerprint_cache: &mut HashMap<String, String>,
    job: SceneWebpJob,
) -> SceneWebpBatchItem {
    let scene_id = job.scene_id.clone();
    let is_poster = job.kind.as_deref() == Some("poster");
    let frame_rate = job.fps.unwrap_or(8).clamp(1, 24);
    let (safe_start, safe_end, duration) = sanitize_scene_time_window(job.start, job.end);

    let source = PathBuf::from(&job.source_path);
    if !source.is_file() {
        return SceneWebpBatchItem {
            scene_id,
            path: None,
            duration: Some(duration),
            cached: false,
            error: Some(format!("Scene source is missing or not a file: {}", source.display())),
        };
    }

    let base = match resolve_scene_webp_cache_base(
        app,
        job.episode_cache_id.as_deref(),
        job.custom_path.as_deref(),
    ) {
        Ok(base) => base,
        Err(error) => {
            return SceneWebpBatchItem {
                scene_id,
                path: None,
                duration: Some(duration),
                cached: false,
                error: Some(error),
            }
        }
    };

    let source_key = source.to_string_lossy().to_string();
    let fingerprint = if let Some(cached) = fingerprint_cache.get(&source_key) {
        cached.clone()
    } else {
        match content_fingerprint(&source) {
            Ok(fp) => {
                fingerprint_cache.insert(source_key.clone(), fp.clone());
                fp
            }
            Err(error) => {
                return SceneWebpBatchItem {
                    scene_id,
                    path: None,
                    duration: Some(duration),
                    cached: false,
                    error: Some(error),
                }
            }
        }
    };

    let key = preview_cache_key_with_fingerprint(
        &fingerprint,
        safe_start,
        safe_end,
        frame_rate,
        is_poster,
    );
    let prefix = if is_poster { "poster" } else { "scene" };
    let cache_path = base.join(format!("{prefix}_{key}.webp"));

    let exists = std::fs::metadata(&cache_path)
        .map(|meta| meta.is_file() && meta.len() > 1024)
        .unwrap_or(false);

    SceneWebpBatchItem {
        scene_id,
        path: if exists {
            Some(cache_path.to_string_lossy().to_string())
        } else {
            None
        },
        duration: Some(duration),
        cached: exists,
        error: None,
    }
}

fn batch_item_from_result(
    scene_id: String,
    result: Result<SceneWebpResult, String>,
) -> SceneWebpBatchItem {
    match result {
        Ok(ok) => SceneWebpBatchItem {
            scene_id: ok.scene_id,
            path: Some(ok.path),
            duration: Some(ok.duration),
            cached: ok.cached,
            error: None,
        },
        Err(error) => SceneWebpBatchItem {
            scene_id,
            path: None,
            duration: None,
            cached: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn generate_scene_webp(
    app: AppHandle,
    proxy_locks: State<'_, PreviewProxyLocks>,
    ffmpeg_pids: State<'_, ActiveFfmpegPids>,
    scene_id: String,
    source_path: String,
    start: f64,
    end: f64,
    fps: Option<u32>,
    episode_cache_id: Option<String>,
    custom_path: Option<String>,
    kind: Option<String>,
) -> Result<SceneWebpResult, String> {
    run_scene_webp_job(
        &app,
        &proxy_locks,
        &ffmpeg_pids,
        SceneWebpJob {
            scene_id,
            source_path,
            start,
            end,
            fps,
            episode_cache_id,
            custom_path,
            kind,
        },
    )
    .await
}

#[tauri::command]
pub async fn generate_scene_webp_batch(
    app: AppHandle,
    proxy_locks: State<'_, PreviewProxyLocks>,
    ffmpeg_pids: State<'_, ActiveFfmpegPids>,
    jobs: Vec<SceneWebpJob>,
) -> Result<SceneWebpBatchResult, String> {
    let mut items: Vec<SceneWebpBatchItem> = Vec::with_capacity(jobs.len());
    let mut iter = jobs.into_iter();
    while let Some(job_a) = iter.next() {
        let job_b = iter.next();

        if let Some(job_b) = job_b {
            let scene_a = job_a.scene_id.clone();
            let scene_b = job_b.scene_id.clone();

            let (res_a, res_b) = tokio::join!(
                run_scene_webp_job(&app, &proxy_locks, &ffmpeg_pids, job_a),
                run_scene_webp_job(&app, &proxy_locks, &ffmpeg_pids, job_b),
            );
            items.push(batch_item_from_result(scene_a, res_a));
            items.push(batch_item_from_result(scene_b, res_b));
            continue;
        }

        let scene_a = job_a.scene_id.clone();
        let res_a = run_scene_webp_job(&app, &proxy_locks, &ffmpeg_pids, job_a).await;
        items.push(batch_item_from_result(scene_a, res_a));
    }

    Ok(SceneWebpBatchResult { items })
}

#[tauri::command]
pub async fn lookup_scene_webp_cache_batch(
    app: AppHandle,
    jobs: Vec<SceneWebpJob>,
) -> Result<SceneWebpBatchResult, String> {
    let started = Instant::now();
    let requested = jobs.len();
    let episode_hint = jobs
        .first()
        .and_then(|job| job.episode_cache_id.clone())
        .unwrap_or_else(|| "none".to_string());

    let mut fingerprint_cache: HashMap<String, String> = HashMap::new();
    let items: Vec<SceneWebpBatchItem> = jobs
        .into_iter()
        .map(|job| lookup_scene_webp_cache_item(&app, &mut fingerprint_cache, job))
        .collect();

    let hits = items.iter().filter(|item| item.path.is_some()).count();
    let misses = requested.saturating_sub(hits);
    let sample_hit = items
        .iter()
        .find_map(|item| item.path.as_deref())
        .map(file_name_only)
        .unwrap_or_else(|| "none".to_string());
    let sample_error = items
        .iter()
        .find_map(|item| item.error.as_deref())
        .unwrap_or("none");

    console_log(
        "WEBP|cache_lookup",
        &format!(
            "episode={} requested={} hits={} misses={} unique_sources={} elapsed_ms={} sample_hit={} sample_error={}",
            episode_hint,
            requested,
            hits,
            misses,
            fingerprint_cache.len(),
            started.elapsed().as_millis(),
            sample_hit,
            sample_error,
        ),
    );

    Ok(SceneWebpBatchResult { items })
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
    let mode_suffix = if transcode_video { "x264" } else { "copy" };
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
                cmd.args(["-c:a", "copy"]);
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
