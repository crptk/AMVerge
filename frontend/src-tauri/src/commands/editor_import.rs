#[cfg(target_os = "windows")]
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};

use crate::commands::export_xml::{export_timeline_xml, TimelineXmlClip};
use crate::payloads::ProgressPayload;
use crate::state::EditorImportAbortState;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::process::apply_no_window;

mod after_effects;
mod capcut;
mod davinci_resolve;
mod premier_pro;

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorTarget {
    #[serde(rename = "premier_pro", alias = "premiere_pro")]
    PremierPro,
    AfterEffects,
    DavinciResolve,
    #[serde(rename = "capcut")]
    CapCut,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalCutClip {
    id: String,
    src: String,
    original_name: Option<String>,
    original_path: Option<String>,
    scene_index: Option<u32>,
    start_sec: Option<f64>,
    end_sec: Option<f64>,
}

#[derive(Debug, Clone)]
struct OriginalCutSegment {
    name: String,
    source_in_sec: f64,
    source_out_sec: f64,
    timeline_start_sec: f64,
    timeline_end_sec: f64,
}

#[derive(Debug, Clone)]
struct SceneClipDescriptor {
    parent_dir: PathBuf,
    prefix: String,
    extension: String,
}

type TimeBounds = (f64, f64);
type IndexedTimeBounds = std::collections::BTreeMap<u32, TimeBounds>;

const ORIGINAL_CUT_DEFAULT_SEQUENCE_NAME: &str = "AMVerge Original Cut";
const ORIGINAL_CUT_MIN_SEGMENT_LEN_SEC: f64 = 1.0 / 30.0;

fn normalize_editor_media_paths(media_paths: Vec<String>) -> Result<Vec<String>, String> {
    if media_paths.is_empty() {
        return Err("No exported media was provided for editor import.".to_string());
    }

    let normalized: Vec<String> = media_paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    if normalized.is_empty() {
        return Err("No valid exported media paths were provided.".to_string());
    }

    let missing: Vec<String> = normalized
        .iter()
        .filter(|p| !Path::new(p).exists())
        .take(5)
        .cloned()
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Some exported files are missing on disk: {}",
            missing.join(", ")
        ));
    }

    Ok(normalized)
}
#[tauri::command]
pub async fn import_media_to_editor(
    app: AppHandle,
    abort_state: State<'_, EditorImportAbortState>,
    editor_target: EditorTarget,
    media_paths: Vec<String>,
) -> Result<String, String> {
    abort_state.abort_requested.store(false, Ordering::SeqCst);
    let normalized = normalize_editor_media_paths(media_paths)?;

    match editor_target {
        EditorTarget::AfterEffects => {
            after_effects::import_into_after_effects(
                &app,
                &normalized,
                &abort_state.abort_requested,
            )
            .await
        }
        EditorTarget::PremierPro => {
            premier_pro::import_into_premier_pro(&app, &normalized, &abort_state.abort_requested)
                .await
        }
        EditorTarget::DavinciResolve => {
            davinci_resolve::import_into_davinci_resolve(
                &app,
                &normalized,
                &abort_state.abort_requested,
            )
            .await
        }
        EditorTarget::CapCut => {
            capcut::import_into_capcut(&app, &normalized, &abort_state.abort_requested).await
        }
    }
}

#[tauri::command]
pub async fn import_original_cut_to_editor(
    app: AppHandle,
    abort_state: State<'_, EditorImportAbortState>,
    editor_target: EditorTarget,
    clips: Vec<OriginalCutClip>,
    sequence_name: Option<String>,
) -> Result<String, String> {
    abort_state.abort_requested.store(false, Ordering::SeqCst);

    match editor_target {
        EditorTarget::AfterEffects => {
            after_effects::import_original_cut_into_after_effects(
                &app,
                &abort_state.abort_requested,
                clips,
                sequence_name,
            )
            .await
        }
        EditorTarget::PremierPro => {
            premier_pro::import_original_cut_into_premier_pro(
                &app,
                &abort_state.abort_requested,
                clips,
                sequence_name,
            )
            .await
        }
        EditorTarget::DavinciResolve => {
            davinci_resolve::import_original_cut_into_davinci_resolve(
                &app,
                &abort_state.abort_requested,
                clips,
                sequence_name,
            )
            .await
        }
        EditorTarget::CapCut => {
            let _ = clips;
            let _ = sequence_name;
            Err(
                "Original-cut export is not available for CapCut. Use standard media export/import."
                    .to_string(),
            )
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn abort_editor_import(
    abort_state: State<'_, EditorImportAbortState>,
) -> Result<String, String> {
    abort_state.abort_requested.store(true, Ordering::SeqCst);
    Ok("Auto-import cancellation requested.".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn abort_editor_import(
    _abort_state: State<'_, EditorImportAbortState>,
) -> Result<String, String> {
    Ok("Auto-import cancellation requested.".to_string())
}

#[cfg(target_os = "windows")]
fn is_import_cancel_requested(abort_requested: &AtomicBool) -> bool {
    abort_requested.load(Ordering::SeqCst)
}

#[cfg(target_os = "windows")]
fn import_canceled_error() -> String {
    "AMVERGE_CANCELED: Auto-import canceled by user.".to_string()
}

#[cfg(target_os = "windows")]
async fn sleep_with_cancel(abort_requested: &AtomicBool, duration: Duration) -> Result<(), String> {
    let mut slept = Duration::ZERO;
    let tick = Duration::from_millis(100);
    while slept < duration {
        if is_import_cancel_requested(abort_requested) {
            return Err(import_canceled_error());
        }
        let wait = (duration - slept).min(tick);
        tokio::time::sleep(wait).await;
        slept += wait;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn run_windows_import_with_retries(
    app: Option<&AppHandle>,
    abort_requested: &AtomicBool,
    log_scope: &str,
    editor_name: &str,
    max_attempts: u32,
    launched_this_call: bool,
    process_name: Option<&str>,
    closed_early_error: &str,
    timeout_error: &str,
    mut run_once: impl FnMut() -> Result<String, String>,
) -> Result<String, String> {
    let mut last_err: Option<String> = None;

    for attempt in 0..max_attempts {
        if is_import_cancel_requested(abort_requested) {
            return Err(import_canceled_error());
        }

        emit_import_progress(
            app,
            99,
            &format!(
                "Waiting for {editor_name} to become ready (attempt {}/{max_attempts})",
                attempt + 1
            ),
        );

        if attempt > 0 {
            let delay_secs = if launched_this_call && attempt < 4 {
                3
            } else {
                2
            };
            sleep_with_cancel(abort_requested, Duration::from_secs(delay_secs)).await?;
        }

        if launched_this_call {
            if let Some(image_name) = process_name {
                if !is_windows_process_running(image_name) {
                    return Err(closed_early_error.to_string());
                }
            }
        }

        match run_once() {
            Ok(msg) => {
                emit_import_progress(app, 100, &msg);
                return Ok(msg);
            }
            Err(err) => {
                if is_import_cancel_requested(abort_requested) {
                    return Err(import_canceled_error());
                }
                let summarized = summarize_windows_import_error(&err);
                if max_attempts > 1 {
                    console_log(
                        log_scope,
                        &format!("attempt {}/{}: {}", attempt + 1, max_attempts, summarized),
                    );
                }
                if !should_retry_windows_import_error(&err, attempt, launched_this_call) {
                    return Err(summarized);
                }
                emit_import_progress(
                    app,
                    99,
                    &format!(
                        "{} (attempt {}/{max_attempts})",
                        import_hint_for_error(editor_name, &err),
                        attempt + 1
                    ),
                );
                last_err = Some(summarized);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| timeout_error.to_string()))
}

#[cfg(target_os = "windows")]
fn emit_import_progress(app: Option<&AppHandle>, percent: u8, message: &str) {
    let Some(app) = app else {
        return;
    };

    let clean = message.replace('\n', " ").replace('\r', " ");
    let _ = app.emit(
        "scene_progress",
        ProgressPayload {
            percent: percent.min(100),
            message: clean,
        },
    );
}

#[cfg(target_os = "windows")]
fn is_windows_process_running(image_name: &str) -> bool {
    let expected = image_name.trim().to_ascii_lowercase();
    if expected.is_empty() {
        return false;
    }

    let mut cmd = Command::new("tasklist");
    apply_no_window(&mut cmd);

    let output = cmd.arg("/FO").arg("CSV").arg("/NH").output();
    let Ok(out) = output else {
        return false;
    };
    if !out.status.success() {
        return false;
    }

    String::from_utf8_lossy(&out.stdout).lines().any(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with('"') {
            return false;
        }

        let Some(end_quote) = trimmed[1..].find('"') else {
            return false;
        };

        let image = trimmed[1..1 + end_quote].trim().to_ascii_lowercase();
        image == expected
    })
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsImportErrorKind {
    Canceled,
    NoWindow,
    NoProject,
    FocusFailed,
    Waiting,
    FilenameFieldNotFound,
    InvalidFilename,
    ResolveBridgeUnavailable,
    ResolveProjectMissing,
    Unknown,
}

#[cfg(target_os = "windows")]
fn classify_windows_import_error(raw: &str) -> WindowsImportErrorKind {
    if raw.contains("AMVERGE_CANCELED") {
        return WindowsImportErrorKind::Canceled;
    }
    if raw.contains("AMVERGE_NO_WINDOW") {
        return WindowsImportErrorKind::NoWindow;
    }
    if raw.contains("AMVERGE_NO_PROJECT") {
        return WindowsImportErrorKind::NoProject;
    }
    if raw.contains("AMVERGE_FOCUS_FAILED") {
        return WindowsImportErrorKind::FocusFailed;
    }
    if raw.contains("AMVERGE_WAITING") {
        return WindowsImportErrorKind::Waiting;
    }
    if raw.contains("AMVERGE_FILENAME_FIELD_NOT_FOUND") {
        return WindowsImportErrorKind::FilenameFieldNotFound;
    }
    if raw.contains("AMVERGE_INVALID_FILENAME") {
        return WindowsImportErrorKind::InvalidFilename;
    }
    if raw.contains("Could not connect to DaVinci Resolve") {
        return WindowsImportErrorKind::ResolveBridgeUnavailable;
    }
    if raw.contains("No Resolve project is open") {
        return WindowsImportErrorKind::ResolveProjectMissing;
    }

    WindowsImportErrorKind::Unknown
}

#[cfg(target_os = "windows")]
fn summarize_windows_import_error(raw: &str) -> String {
    match classify_windows_import_error(raw) {
        WindowsImportErrorKind::Canceled => {
            "AMVERGE_CANCELED: Auto-import canceled by user.".to_string()
        }
        WindowsImportErrorKind::NoWindow => {
            "AMVERGE_NO_WINDOW: Editor window not found yet.".to_string()
        }
        WindowsImportErrorKind::NoProject => {
            "AMVERGE_NO_PROJECT: No project is open yet.".to_string()
        }
        WindowsImportErrorKind::FocusFailed => {
            "AMVERGE_FOCUS_FAILED: Could not bring editor window to the foreground.".to_string()
        }
        WindowsImportErrorKind::Waiting => "AMVERGE_WAITING: Editor is still loading.".to_string(),
        WindowsImportErrorKind::FilenameFieldNotFound => {
            "AMVERGE_FILENAME_FIELD_NOT_FOUND: Could not access the editor dialog file-name field."
                .to_string()
        }
        WindowsImportErrorKind::InvalidFilename => {
            "AMVERGE_INVALID_FILENAME: Imported file path was rejected by the editor dialog."
                .to_string()
        }
        WindowsImportErrorKind::ResolveBridgeUnavailable => "DaVinci Resolve scripting bridge did not connect. In Resolve, enable External scripting using Local (Preferences > System > General), then retry.".to_string(),
        WindowsImportErrorKind::ResolveProjectMissing => {
            "No DaVinci Resolve project is open. Open/create a project in Resolve, then retry."
                .to_string()
        }
        WindowsImportErrorKind::Unknown => raw
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "Unknown import error.".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn should_retry_windows_import_error(
    raw: &str,
    attempt_index: u32,
    launched_this_call: bool,
) -> bool {
    match classify_windows_import_error(raw) {
        WindowsImportErrorKind::NoWindow
        | WindowsImportErrorKind::NoProject
        | WindowsImportErrorKind::FocusFailed
        | WindowsImportErrorKind::Waiting
        | WindowsImportErrorKind::FilenameFieldNotFound => {
            let max_attempts = if launched_this_call { 12 } else { 4 };
            attempt_index + 1 < max_attempts
        }
        // Resolve can take a bit of time to expose scripting after launch.
        WindowsImportErrorKind::ResolveBridgeUnavailable => launched_this_call && attempt_index < 8,
        WindowsImportErrorKind::Canceled
        | WindowsImportErrorKind::InvalidFilename
        | WindowsImportErrorKind::ResolveProjectMissing
        | WindowsImportErrorKind::Unknown => false,
    }
}

#[cfg(target_os = "windows")]
fn import_hint_for_error(editor_name: &str, raw: &str) -> String {
    match classify_windows_import_error(raw) {
        WindowsImportErrorKind::Canceled => "Canceling auto-import...".to_string(),
        WindowsImportErrorKind::NoWindow => format!("{editor_name} is still loading"),
        WindowsImportErrorKind::NoProject => {
            if editor_name == "After Effects" {
                return "Select an existing .aep project from the Home screen to continue auto-import"
                    .to_string();
            }
            format!("Open or create a project in {editor_name} to continue auto-import")
        }
        WindowsImportErrorKind::FocusFailed => {
            format!("Click the {editor_name} window to bring it to front")
        }
        WindowsImportErrorKind::Waiting => format!("Waiting for {editor_name}"),
        WindowsImportErrorKind::FilenameFieldNotFound => {
            format!("Re-targeting {editor_name} import field")
        }
        WindowsImportErrorKind::InvalidFilename => {
            format!("{editor_name} rejected imported file path")
        }
        WindowsImportErrorKind::ResolveBridgeUnavailable => {
            "Waiting for DaVinci Resolve scripting bridge".to_string()
        }
        WindowsImportErrorKind::ResolveProjectMissing | WindowsImportErrorKind::Unknown => {
            format!("Waiting for {editor_name}")
        }
    }
}

fn parse_scene_suffix_index(suffix: &str) -> Option<u32> {
    if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    suffix.parse::<u32>().ok()
}

fn split_scene_stem_and_index(stem: &str) -> Option<(&str, u32)> {
    let (base, suffix) = stem.rsplit_once('_')?;
    Some((base, parse_scene_suffix_index(suffix)?))
}

fn parse_scene_index_from_clip_path(path: &str) -> Option<u32> {
    let stem = Path::new(path).file_stem()?.to_str()?;
    split_scene_stem_and_index(stem).map(|(_, index)| index)
}

fn parse_scene_descriptor_from_clip_path(path: &str) -> Option<SceneClipDescriptor> {
    let clip_path = Path::new(path);
    let parent_dir = clip_path.parent()?.to_path_buf();
    let stem = clip_path.file_stem()?.to_str()?;
    let extension = clip_path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())?;
    let (base, _) = split_scene_stem_and_index(stem)?;

    Some(SceneClipDescriptor {
        parent_dir,
        prefix: format!("{base}_"),
        extension,
    })
}

fn probe_clip_duration_sec(ffprobe: &Path, clip_path: &Path) -> Result<f64, String> {
    let mut cmd = Command::new(ffprobe);
    apply_no_window(&mut cmd);
    let output = cmd
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nk=1:nw=1",
            clip_path.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|e| {
            format!(
                "Failed to run ffprobe for {} ({}): {e}",
                clip_path.display(),
                ffprobe.display()
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("ffprobe failed for {}", clip_path.display())
        } else {
            format!("ffprobe failed for {}: {}", clip_path.display(), stderr)
        });
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = raw
        .lines()
        .next()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or_else(|| {
            format!(
                "Could not parse clip duration for {} from ffprobe output: {}",
                clip_path.display(),
                raw
            )
        })?;

    Ok(parsed)
}

fn build_scene_time_bounds_from_directory(
    app: &AppHandle,
    descriptor: &SceneClipDescriptor,
    min_segment_len: f64,
) -> Result<IndexedTimeBounds, String> {
    let ffprobe = resolve_bundled_tool(app, "ffprobe")?;
    let mut indexed_durations: std::collections::BTreeMap<u32, f64> =
        std::collections::BTreeMap::new();

    let entries = fs::read_dir(&descriptor.parent_dir).map_err(|e| {
        format!(
            "Failed to read scene directory {}: {e}",
            descriptor.parent_dir.display()
        )
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let extension_matches = path
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| v.eq_ignore_ascii_case(&descriptor.extension))
            .unwrap_or(false);
        if !extension_matches {
            continue;
        }

        let Some(stem) = path.file_stem().and_then(|v| v.to_str()) else {
            continue;
        };
        if !stem.starts_with(&descriptor.prefix) {
            continue;
        }

        let Some(suffix) = stem.strip_prefix(&descriptor.prefix) else {
            continue;
        };
        let Some(index) = parse_scene_suffix_index(suffix) else {
            continue;
        };

        match probe_clip_duration_sec(&ffprobe, &path) {
            Ok(duration) => {
                indexed_durations.insert(index, duration.max(min_segment_len));
            }
            Err(err) => {
                console_log(
                    "NLE|original_cut",
                    &format!("duration probe skipped {} ({err})", path.display()),
                );
            }
        }
    }

    if indexed_durations.is_empty() {
        return Err(format!(
            "No scene clip durations could be probed in {}.",
            descriptor.parent_dir.display()
        ));
    }

    let mut running = 0.0_f64;
    let mut bounds: IndexedTimeBounds = std::collections::BTreeMap::new();
    for (index, duration) in indexed_durations {
        let start = running;
        let end = start + duration.max(min_segment_len);
        bounds.insert(index, (start, end));
        running = end;
    }

    Ok(bounds)
}

fn build_time_bounds_from_selected_order(
    app: &AppHandle,
    clips: &[OriginalCutClip],
    min_segment_len: f64,
) -> Result<Vec<TimeBounds>, String> {
    let ffprobe = resolve_bundled_tool(app, "ffprobe")?;
    let mut running = 0.0_f64;
    let mut bounds: Vec<TimeBounds> = Vec::with_capacity(clips.len());

    for clip in clips {
        let clip_path = Path::new(&clip.src);
        if !clip_path.exists() {
            return Err(format!(
                "Scene clip file is missing: {}",
                clip_path.display()
            ));
        }

        let duration = probe_clip_duration_sec(&ffprobe, clip_path)?.max(min_segment_len);
        let start = running;
        let end = start + duration;
        bounds.push((start, end));
        running = end;
    }

    Ok(bounds)
}

fn extract_original_media_path(clips: &[OriginalCutClip]) -> Result<String, String> {
    clips
        .iter()
        .find_map(|clip| {
            clip.original_path
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        })
        .ok_or(
            "Missing original media path in clip metadata. Re-import the episode and retry."
                .to_string(),
        )
}

fn ensure_single_original_media_path(
    clips: &[OriginalCutClip],
    original_path: &str,
) -> Result<(), String> {
    for clip in clips {
        if let Some(candidate) = clip
            .original_path
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            if candidate != original_path {
                return Err(
                    "Selected clips do not reference the same original media file.".to_string(),
                );
            }
        }
    }

    Ok(())
}

fn infer_missing_scene_indexes(clips: &mut [OriginalCutClip]) {
    for clip in clips {
        if clip.scene_index.is_none() {
            clip.scene_index = parse_scene_index_from_clip_path(&clip.src);
        }
    }
}

fn sort_original_cut_clips(clips: &mut [OriginalCutClip]) {
    clips.sort_by(|a, b| {
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
}

fn infer_scene_time_bounds(
    app: &AppHandle,
    clips: &[OriginalCutClip],
    min_segment_len: f64,
) -> Option<IndexedTimeBounds> {
    clips
        .iter()
        .find_map(|clip| parse_scene_descriptor_from_clip_path(&clip.src))
        .and_then(|descriptor| {
            build_scene_time_bounds_from_directory(app, &descriptor, min_segment_len).ok()
        })
}

fn resolve_segment_name(clip: &OriginalCutClip) -> String {
    let fallback_name = Path::new(&clip.src)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("clip")
        .to_string();
    clip.original_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(fallback_name)
}

fn normalize_sequence_name(sequence_name: Option<String>) -> String {
    sequence_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| ORIGINAL_CUT_DEFAULT_SEQUENCE_NAME.to_string())
}

fn build_original_cut_segments(
    ordered: &[OriginalCutClip],
    inferred_bounds: Option<&IndexedTimeBounds>,
    ordered_fallback_bounds: Option<&[TimeBounds]>,
    min_segment_len: f64,
) -> Result<Vec<OriginalCutSegment>, String> {
    let mut timeline_cursor = 0.0_f64;
    let mut segments: Vec<OriginalCutSegment> = Vec::with_capacity(ordered.len());

    for (idx, clip) in ordered.iter().enumerate() {
        let inferred_for_clip = clip
            .scene_index
            .and_then(|scene_idx| inferred_bounds.and_then(|m| m.get(&scene_idx)))
            .copied();
        let ordered_fallback_for_clip = ordered_fallback_bounds.and_then(|v| v.get(idx)).copied();

        let start_sec = clip
            .start_sec
            .or_else(|| inferred_for_clip.map(|(start, _)| start))
            .or_else(|| ordered_fallback_for_clip.map(|(start, _)| start))
            .ok_or(
                "Clip cut metadata is incomplete. AMVerge could not infer scene timing from cached clips. Re-import this episode and retry exporting original cut.",
            )?;

        let next_start = ordered.get(idx + 1).and_then(|c| c.start_sec);
        let mut end_sec = clip
            .end_sec
            .or(next_start)
            .or_else(|| inferred_for_clip.map(|(_, end)| end))
            .or_else(|| ordered_fallback_for_clip.map(|(_, end)| end))
            .unwrap_or(start_sec + min_segment_len);
        if !end_sec.is_finite() || end_sec <= start_sec {
            end_sec = start_sec + min_segment_len;
        }

        let duration = (end_sec - start_sec).max(min_segment_len);
        let timeline_start = timeline_cursor;
        let timeline_end = timeline_start + duration;
        timeline_cursor = timeline_end;

        segments.push(OriginalCutSegment {
            name: resolve_segment_name(clip),
            source_in_sec: start_sec,
            source_out_sec: end_sec,
            timeline_start_sec: timeline_start,
            timeline_end_sec: timeline_end,
        });
    }

    if segments.is_empty() {
        return Err("No valid cut segments were generated.".to_string());
    }

    Ok(segments)
}

fn normalize_original_cut_input(
    app: &AppHandle,
    clips: Vec<OriginalCutClip>,
    sequence_name: Option<String>,
) -> Result<(String, String, Vec<OriginalCutSegment>), String> {
    if clips.is_empty() {
        return Err("No clips selected for original-cut import.".to_string());
    }

    let original_path = extract_original_media_path(&clips)?;
    ensure_single_original_media_path(&clips, &original_path)?;

    if !Path::new(&original_path).exists() {
        return Err(format!(
            "Original media file no longer exists: {}",
            original_path
        ));
    }

    let min_segment_len = ORIGINAL_CUT_MIN_SEGMENT_LEN_SEC;
    let mut ordered = clips;
    infer_missing_scene_indexes(&mut ordered);
    let inferred_bounds = infer_scene_time_bounds(app, &ordered, min_segment_len);
    sort_original_cut_clips(&mut ordered);

    let ordered_fallback_bounds =
        build_time_bounds_from_selected_order(app, &ordered, min_segment_len).ok();
    let segments = build_original_cut_segments(
        &ordered,
        inferred_bounds.as_ref(),
        ordered_fallback_bounds.as_deref(),
        min_segment_len,
    )?;

    Ok((
        original_path,
        normalize_sequence_name(sequence_name),
        segments,
    ))
}

async fn write_original_cut_timeline_xml(
    app: &AppHandle,
    original_path: &str,
    sequence_name: &str,
    segments: &[OriginalCutSegment],
    xml_prefix: &str,
) -> Result<PathBuf, String> {
    let mut clips: Vec<TimelineXmlClip> = Vec::with_capacity(segments.len());
    for (idx, segment) in segments.iter().enumerate() {
        let scene_index =
            u32::try_from(idx).map_err(|_| "Too many cut segments for XML export.".to_string())?;
        clips.push(TimelineXmlClip {
            id: format!("original_cut_segment_{}", idx + 1),
            src: original_path.to_string(),
            original_name: Some(segment.name.clone()),
            original_path: Some(original_path.to_string()),
            scene_index: Some(scene_index),
            start_sec: Some(segment.source_in_sec),
            end_sec: Some(segment.source_out_sec),
        });
    }

    let xml_path = runtime_temp_path(xml_prefix, "xml")?;
    export_timeline_xml(
        app.clone(),
        clips,
        xml_path.to_string_lossy().to_string(),
        Some(sequence_name.to_string()),
    )
    .await?;

    if !xml_path.exists() {
        return Err(format!(
            "Timeline XML was not created: {}",
            xml_path.display()
        ));
    }

    Ok(xml_path)
}

#[cfg(target_os = "windows")]
fn escape_jsx_double_quoted(raw: &str) -> String {
    raw.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

#[cfg(target_os = "windows")]
fn spawn_editor_process(
    executable: &Path,
    editor_name: &str,
    log_scope: &str,
) -> Result<(), String> {
    console_log(
        log_scope,
        &format!("launching {editor_name}: {}", executable.display()),
    );

    let mut launch_cmd = Command::new(executable);
    apply_no_window(&mut launch_cmd);
    launch_cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    launch_cmd.spawn().map_err(|e| {
        format!(
            "Failed to launch {editor_name} ({}): {e}",
            executable.display()
        )
    })?;

    Ok(())
}

fn run_editor_ui_import_ps(script_path: &Path, editor_name: &str) -> Result<String, String> {
    let mut cmd = Command::new("powershell");
    apply_no_window(&mut cmd);
    let out = cmd
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-STA")
        .arg("-File")
        .arg(script_path)
        .output()
        .map_err(|e| format!("Failed to run {editor_name} importer script: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

    if out.status.success() {
        Ok(if stdout.is_empty() {
            format!("{editor_name} import complete.")
        } else {
            stdout
        })
    } else {
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "No error output.".to_string()
        };
        Err(detail)
    }
}

#[cfg(target_os = "windows")]
fn run_python_script(script_path: &Path) -> Result<String, String> {
    let mut launch_errors: Vec<String> = Vec::new();

    let candidates: Vec<(String, Vec<String>)> = if cfg!(target_os = "windows") {
        let mut c: Vec<(String, Vec<String>)> = Vec::new();
        if let Some(p) = resolve_local_venv_python() {
            c.push((p.to_string_lossy().to_string(), vec![]));
        }
        c.push(("python".to_string(), vec![]));
        c.push(("py".to_string(), vec!["-3".to_string()]));
        c
    } else {
        vec![
            ("python3".to_string(), vec![]),
            ("python".to_string(), vec![]),
        ]
    };

    for (exe, extra_args) in candidates {
        let mut cmd = Command::new(&exe);
        apply_no_window(&mut cmd);
        cmd.args(extra_args)
            .arg(script_path)
            .env("PYTHONIOENCODING", "utf-8");

        #[cfg(target_os = "windows")]
        {
            if let Some(resolve_exe) = resolve_davinci_executable() {
                if let Some(resolve_dir) = resolve_exe.parent() {
                    let resolve_dir_str = resolve_dir.to_string_lossy().to_string();
                    let script_api_dir = PathBuf::from(
                        std::env::var("PROGRAMDATA")
                            .unwrap_or_else(|_| r"C:\ProgramData".to_string()),
                    )
                    .join("Blackmagic Design")
                    .join("DaVinci Resolve")
                    .join("Support")
                    .join("Developer")
                    .join("Scripting");
                    let modules_dir = script_api_dir.join("Modules");
                    let resolve_script_lib = resolve_dir.join("fusionscript.dll");

                    // Official Resolve scripting env.
                    cmd.env(
                        "RESOLVE_SCRIPT_API",
                        script_api_dir.to_string_lossy().to_string(),
                    );
                    cmd.env(
                        "RESOLVE_SCRIPT_LIB",
                        resolve_script_lib.to_string_lossy().to_string(),
                    );

                    // Ensure Python can import Resolve modules.
                    let mut pythonpath_parts: Vec<String> = Vec::new();
                    if let Ok(existing) = std::env::var("PYTHONPATH") {
                        if !existing.trim().is_empty() {
                            pythonpath_parts.push(existing);
                        }
                    }
                    pythonpath_parts.push(modules_dir.to_string_lossy().to_string());
                    cmd.env("PYTHONPATH", pythonpath_parts.join(";"));

                    // Ensure fusionscript.dll deps resolve.
                    let mut path_parts: Vec<String> = vec![resolve_dir_str];
                    if let Ok(existing_path) = std::env::var("PATH") {
                        if !existing_path.trim().is_empty() {
                            path_parts.push(existing_path);
                        }
                    }
                    cmd.env("PATH", path_parts.join(";"));
                }
            }
        }

        match cmd.output() {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

                if out.status.success() {
                    let msg = if stdout.is_empty() {
                        "DaVinci Resolve import command sent.".to_string()
                    } else {
                        stdout
                    };
                    return Ok(msg);
                }

                if !stderr.is_empty() {
                    launch_errors.push(format!("{exe} stderr: {stderr}"));
                }
                if !stdout.is_empty() {
                    launch_errors.push(format!("{exe} stdout: {stdout}"));
                }
                if stderr.is_empty() && stdout.is_empty() {
                    launch_errors.push(format!("{exe} exited with status {}", out.status));
                }
            }
            Err(e) => {
                launch_errors.push(format!("{exe} failed to start: {e}"));
            }
        }
    }

    Err(format!(
        "{}\nFailed to run DaVinci scripting bridge.",
        launch_errors.join("\n")
    ))
}

#[cfg(target_os = "windows")]
fn resolve_local_venv_python() -> Option<PathBuf> {
    let current = std::env::current_dir().ok()?;
    let candidate_roots = if current.ends_with("src-tauri") {
        vec![
            current
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf()),
            Some(current.clone()),
        ]
    } else {
        vec![Some(current)]
    };

    for root in candidate_roots.into_iter().flatten() {
        let python = root
            .join("backend")
            .join("venv")
            .join("Scripts")
            .join("python.exe");
        if python.exists() {
            return Some(python);
        }
    }

    None
}

fn runtime_temp_path(prefix: &str, extension: &str) -> Result<PathBuf, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    let mut path = script_runtime_dir();
    fs::create_dir_all(&path).map_err(|e| {
        format!(
            "Failed to create script runtime directory ({}): {e}",
            path.display()
        )
    })?;

    path.push(format!(
        "{prefix}_{}_{}.{}",
        std::process::id(),
        ts,
        extension
    ));

    Ok(path)
}

fn write_temp_script(prefix: &str, extension: &str, content: &str) -> Result<PathBuf, String> {
    let path = runtime_temp_path(prefix, extension)?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write temp script {}: {e}", path.display()))?;
    Ok(path)
}

fn script_runtime_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data)
                .join("AMVerge")
                .join("runtime_scripts");
        }
    }

    std::env::temp_dir().join("amverge").join("runtime_scripts")
}

#[cfg(target_os = "windows")]
fn build_editor_ui_import_ps(
    media_paths: &[String],
    process_name: &str,
    editor_name: &str,
    no_window_error: &str,
    no_project_error: &str,
    window_title_match_expression: &str,
    project_ready_expression: &str,
    dialog_reject_expression: &str,
) -> String {
    let files = media_paths
        .iter()
        .map(|p| normalize_windows_editor_import_path(p))
        .map(|p| format!("'{}'", escape_ps_single_quoted(&p)))
        .collect::<Vec<_>>()
        .join(",\n    ");

    let template = r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Focus {{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {{
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }}
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern int GetDlgCtrlID(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetDlgItem(IntPtr hDlg, int nIDDlgItem);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool SetDlgItemText(IntPtr hDlg, int nIDDlgItem, string lpString);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
    public const int SW_RESTORE = 9;
    public const uint WM_SETTEXT = 0x000C;
    public const uint WM_USER = 0x0400;
    public const uint CDM_FIRST = WM_USER + 100;
    public const uint CDM_SETCONTROLTEXT = CDM_FIRST + 4;
}}
'@ -ErrorAction SilentlyContinue

$paths = @(
    __FILES__
)

$CDLG_CMB13 = 0x47C
$CDLG_EDT1 = 0x480
$COMMON_EDIT_CLASSES = @('edit', 'combobox', 'comboboxex32', 'richedit20w')

function Get-EditorWindow([string]$processName) {{
    $procs = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
    if ((-not $procs -or $procs.Count -eq 0) -and $processName.Contains('*')) {{
        $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {{ $_.ProcessName -like $processName }})
    }}
    $procIds = @($procs | Select-Object -ExpandProperty Id)
    if (-not $procIds -or $procIds.Count -eq 0) {{
        return $null
    }}

    $script:windowMatches = New-Object 'System.Collections.Generic.List[object]'
    $callback = [Win32Focus+EnumWindowsProc] {{
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32Focus]::IsWindowVisible($hWnd)) {{
            return $true
        }}

        $len = [Win32Focus]::GetWindowTextLength($hWnd)
        if ($len -le 0) {{
            return $true
        }}

        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [void][Win32Focus]::GetWindowText($hWnd, $sb, $sb.Capacity)
        $title = $sb.ToString().Trim()
        if ([string]::IsNullOrWhiteSpace($title)) {{
            return $true
        }}

        $titleLower = $title.ToLowerInvariant()
        if (-not (__WINDOW_TITLE_MATCH_EXPRESSION__)) {{
            return $true
        }}

        $procId = [uint32]0
        [void][Win32Focus]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ($procIds -contains [int]$procId) {{
            $classSb = New-Object System.Text.StringBuilder 256
            [void][Win32Focus]::GetClassName($hWnd, $classSb, $classSb.Capacity)
            $className = $classSb.ToString()
            if ($className -eq '#32770') {{
                return $true
            }}

            $script:windowMatches.Add([pscustomobject]@{{
                Handle = $hWnd
                Title = $title
                ProcessId = [int]$procId
                ClassName = $className
            }}) | Out-Null
        }}

        return $true
    }}

    [void][Win32Focus]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:windowMatches.Count -eq 0) {{
        return $null
    }}

    $best = $script:windowMatches |
        Sort-Object -Property @{{
            Expression = {{
                $t = $_.Title.ToLowerInvariant()
                if (($t -match '\.aep') -and ($t -notmatch 'untitled|sans titre')) {{ 5 }}
                elseif ($t -match '\.prproj') {{ 5 }}
                elseif ($t -match 'home|accueil') {{ 0 }}
                elseif ($t -match 'untitled|sans titre') {{ 1 }}
                elseif ($t -match 'project|projet') {{ 2 }}
                else {{ 2 }}
            }}
        }}, @{{
            Expression = {{ $_.Title.Length }}
        }} -Descending |
        Select-Object -First 1

    return $best
}}

function Get-ProcessDialogWindow([int]$targetProcessId) {{
    $script:dialogMatches = New-Object 'System.Collections.Generic.List[object]'
    $callback = [Win32Focus+EnumWindowsProc] {{
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32Focus]::IsWindowVisible($hWnd)) {{
            return $true
        }}

        $procId = [uint32]0
        [void][Win32Focus]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ([int]$procId -ne $targetProcessId) {{
            return $true
        }}

        $classSb = New-Object System.Text.StringBuilder 256
        [void][Win32Focus]::GetClassName($hWnd, $classSb, $classSb.Capacity)
        $className = $classSb.ToString()
        if ($className -ne '#32770') {{
            return $true
        }}

        $len = [Win32Focus]::GetWindowTextLength($hWnd)
        $title = ''
        if ($len -gt 0) {{
            $sb = New-Object System.Text.StringBuilder ($len + 1)
            [void][Win32Focus]::GetWindowText($hWnd, $sb, $sb.Capacity)
            $title = $sb.ToString().Trim()
        }}

        $script:dialogMatches.Add([pscustomobject]@{{
            Handle = $hWnd
            Title = $title
            ProcessId = [int]$procId
            ClassName = $className
        }}) | Out-Null

        return $true
    }}

    [void][Win32Focus]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:dialogMatches.Count -eq 0) {{
        return $null
    }}

    return ($script:dialogMatches | Sort-Object -Property @{{
        Expression = {{ $_.Title.Length }}
    }} -Descending | Select-Object -First 1)
}}

function Test-IsForegroundProcess([int]$targetProcessId) {{
    $foreground = [Win32Focus]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) {{
        return $false
    }}

    $foregroundProcessId = [uint32]0
    [void][Win32Focus]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId)
    return ([int]$foregroundProcessId -eq $targetProcessId)
}}

function Set-EditorForeground([IntPtr]$hwnd, [int]$targetProcessId) {{
    if ([Win32Focus]::IsIconic($hwnd)) {{
        [Win32Focus]::ShowWindow($hwnd, [Win32Focus]::SW_RESTORE) | Out-Null
        Start-Sleep -Milliseconds 250
    }}

    [Win32Focus]::SetForegroundWindow($hwnd) | Out-Null
    [Win32Focus]::BringWindowToTop($hwnd) | Out-Null
    Start-Sleep -Milliseconds 250

    if (Test-IsForegroundProcess $targetProcessId) {{
        return $true
    }}

    try {{
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.AppActivate($targetProcessId)
    }} catch {{
    }}
    Start-Sleep -Milliseconds 250

    if (Test-IsForegroundProcess $targetProcessId) {{
        return $true
    }}

    $foreground = [Win32Focus]::GetForegroundWindow()
    $scratch = [uint32]0
    $foregroundThread = [Win32Focus]::GetWindowThreadProcessId($foreground, [ref]$scratch)
    $appThread = [Win32Focus]::GetWindowThreadProcessId($hwnd, [ref]$scratch)

    if ($foregroundThread -ne $appThread) {{
        [Win32Focus]::AttachThreadInput($foregroundThread, $appThread, $true) | Out-Null
        [Win32Focus]::SetForegroundWindow($hwnd) | Out-Null
        [Win32Focus]::BringWindowToTop($hwnd) | Out-Null
        [Win32Focus]::AttachThreadInput($foregroundThread, $appThread, $false) | Out-Null
        Start-Sleep -Milliseconds 250
    }}

    return (Test-IsForegroundProcess $targetProcessId)
}}

function Set-DialogFileName($dialog, [string]$value) {{
    if ([string]::IsNullOrWhiteSpace($value)) {{
        return $false
    }}

    # Explorer-style API contract way.
    foreach ($controlId in @($CDLG_EDT1, $CDLG_CMB13)) {{
        try {{
            [void][Win32Focus]::SendMessage(
                $dialog.Handle,
                [Win32Focus]::CDM_SETCONTROLTEXT,
                [IntPtr]$controlId,
                $value
            )
        }} catch {{
        }}
    }}

    # Prefer native Win32 control IDs for Explorer-style file dialogs:
    # cmb13 (0x47C) and edt1 (0x480).
    foreach ($controlId in @($CDLG_EDT1, $CDLG_CMB13)) {{
        try {{
            $ctrl = [Win32Focus]::GetDlgItem($dialog.Handle, $controlId)
            if ($ctrl -ne [IntPtr]::Zero) {{
                [void][Win32Focus]::SendMessage($ctrl, [Win32Focus]::WM_SETTEXT, [IntPtr]::Zero, $value)
                if ([Win32Focus]::SetDlgItemText($dialog.Handle, $controlId, $value)) {{
                    return $true
                }}
                return $true
            }}
        }} catch {{
        }}
    }}

    # Fallback: scan child controls and write to Edit/Combo controls directly.
    try {{
        $script:candidateHandles = New-Object 'System.Collections.Generic.List[object]'
        $enumChild = [Win32Focus+EnumWindowsProc] {{
            param([IntPtr]$hWnd, [IntPtr]$lParam)
            try {{
                $classSb = New-Object System.Text.StringBuilder 256
                [void][Win32Focus]::GetClassName($hWnd, $classSb, $classSb.Capacity)
                $cls = $classSb.ToString().ToLowerInvariant()
                if ($COMMON_EDIT_CLASSES -contains $cls) {{
                    $script:candidateHandles.Add($hWnd) | Out-Null
                }}
            }} catch {{
            }}
            return $true
        }}
        [void][Win32Focus]::EnumChildWindows($dialog.Handle, $enumChild, [IntPtr]::Zero)

        for ($i = 0; $i -lt $script:candidateHandles.Count; $i++) {{
            $h = $script:candidateHandles.Item($i)
            try {{
                [void][Win32Focus]::SendMessage($h, [Win32Focus]::WM_SETTEXT, [IntPtr]::Zero, $value)
                $id = [Win32Focus]::GetDlgCtrlID($h)
                if ($id -gt 0) {{
                    if ([Win32Focus]::SetDlgItemText($dialog.Handle, $id, $value)) {{
                        return $true
                    }}
                }}
            }} catch {{
            }}
        }}
    }} catch {{
    }}

    try {{
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($dialog.Handle)
        if (-not $root) {{
            return $false
        }}

        $dialogRect = New-Object 'Win32Focus+RECT'
        $hasDialogRect = [Win32Focus]::GetWindowRect($dialog.Handle, [ref]$dialogRect)
        $minInputTop = [double]::NegativeInfinity
        if ($hasDialogRect) {{
            $dialogHeight = [Math]::Max(1, $dialogRect.Bottom - $dialogRect.Top)
            $minInputTop = $dialogRect.Top + ($dialogHeight * 0.55)
        }}

        $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if (-not $edits -or $edits.Count -eq 0) {{
            return $false
        }}

        $target = $null
        $bestScore = [double]::NegativeInfinity
        for ($i = 0; $i -lt $edits.Count; $i++) {{
            $edit = $edits.Item($i)
            if (-not $edit) {{
                continue
            }}

            $score = 0.0
            try {{
                $name = ([string]$edit.Current.Name).ToLowerInvariant()
                if ($name -match 'file\s*name|nom.*fichier|filename') {{
                    $score += 1000
                }}
            }} catch {{
            }}

            try {{
                $automationId = ([string]$edit.Current.AutomationId).ToLowerInvariant()
                if ($automationId -match '^(1148|1152)$') {{
                    $score += 2000
                }}
                if ($automationId -match 'file|name') {{
                    $score += 400
                }}
            }} catch {{
            }}

            try {{
                $rect = $edit.Current.BoundingRectangle
                if ($hasDialogRect -and $rect.Top -lt $minInputTop) {{
                    continue
                }}
                $score += [double]$rect.Bottom
                if ($rect.Width -gt 120) {{
                    $score += 100
                }}
            }} catch {{
            }}

            if ($score -gt $bestScore) {{
                $bestScore = $score
                $target = $edit
            }}
        }}

        if (-not $target) {{
            return $false
        }}

        $valuePattern = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if (-not $valuePattern) {{
            return $false
        }}
        $valuePattern.SetValue($value)
        return $true
    }} catch {{
    }}

    return $false
}}

function Submit-DialogValue($dialog, [string]$value) {{
    [Win32Focus]::SetForegroundWindow($dialog.Handle) | Out-Null
    Start-Sleep -Milliseconds 120

    if (-not (Set-DialogFileName $dialog $value)) {{
        throw ('AMVERGE_FILENAME_FIELD_NOT_FOUND: Unable to target "File name" field for path: ' + $value)
    }}

    [System.Windows.Forms.SendKeys]::SendWait('~')
    Start-Sleep -Milliseconds 260
}}

$window = Get-EditorWindow '__PROCESS_NAME__'
if (-not $window) {{
    throw '__NO_WINDOW_ERROR__'
}}

$title = [string]$window.Title
$titleLower = $title.ToLowerInvariant()
$projectReady = __PROJECT_READY_EXPRESSION__
if (-not $projectReady) {{
    throw ('__NO_PROJECT_ERROR__ (window title: ' + $title + ')')
}}

if (-not (Set-EditorForeground $window.Handle $window.ProcessId)) {{
    throw 'AMVERGE_FOCUS_FAILED: Could not bring __EDITOR_NAME__ to foreground.'
}}

# --- Import each file via Ctrl+I shortcut ---
foreach ($p in $paths) {{
    if (-not (Test-Path -LiteralPath $p)) {{
        throw ('File not found: ' + $p)
    }}

    if (-not (Set-EditorForeground $window.Handle $window.ProcessId)) {{
        throw 'AMVERGE_FOCUS_FAILED: Could not keep __EDITOR_NAME__ in foreground.'
    }}

    # Open Import dialog
    [System.Windows.Forms.SendKeys]::SendWait('^i')
    Start-Sleep -Milliseconds 200

    $dialog = $null
    for ($i = 0; $i -lt 18; $i++) {{
        $dialog = Get-ProcessDialogWindow $window.ProcessId
        if ($dialog) {{
            break
        }}
        Start-Sleep -Milliseconds 120
    }}

    if (-not $dialog) {{
        throw '__NO_PROJECT_ERROR__'
    }}

    $dialogTitleLower = [string]$dialog.Title
    $dialogTitleLower = $dialogTitleLower.ToLowerInvariant()
    if (__DIALOG_REJECT_EXPRESSION__) {{
        throw ('__NO_PROJECT_ERROR__ (dialog title: ' + $dialog.Title + ')')
    }}

    Submit-DialogValue $dialog $p

    for ($i = 0; $i -lt 30; $i++) {{
        $stillOpen = Get-ProcessDialogWindow $window.ProcessId
        if (-not $stillOpen) {{
            break
        }}
        Start-Sleep -Milliseconds 120
    }}

    if ($stillOpen) {{
        $stillOpenTitle = [string]$stillOpen.Title
        throw ('AMVERGE_INVALID_FILENAME: Import dialog stayed open after path submit. Path=' + $p + '; Dialog=' + $stillOpenTitle)
    }}

    Start-Sleep -Milliseconds 350
}}

Write-Output '__EDITOR_NAME__ import complete.'
"#;

    let normalized_template = template.replace("{{", "{").replace("}}", "}");

    normalized_template
        .replace("__FILES__", &files)
        .replace("__PROCESS_NAME__", process_name)
        .replace("__EDITOR_NAME__", editor_name)
        .replace("__NO_WINDOW_ERROR__", no_window_error)
        .replace("__NO_PROJECT_ERROR__", no_project_error)
        .replace(
            "__WINDOW_TITLE_MATCH_EXPRESSION__",
            window_title_match_expression,
        )
        .replace("__PROJECT_READY_EXPRESSION__", project_ready_expression)
        .replace("__DIALOG_REJECT_EXPRESSION__", dialog_reject_expression)
}

#[cfg(target_os = "windows")]
fn escape_py_single_quoted(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('\'', "\\'")
}

#[cfg(target_os = "windows")]
fn normalize_windows_editor_import_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    trimmed.replace('/', "\\")
}

#[cfg(target_os = "windows")]
fn should_stage_windows_editor_import_path(path: &str) -> bool {
    let normalized = normalize_windows_editor_import_path(path);
    if normalized.is_empty() {
        return true;
    }

    if normalized.len() >= 180 {
        return true;
    }

    let lowered = normalized.to_ascii_lowercase();
    lowered.contains("\\appdata\\roaming\\")
        || lowered.contains("\\appdata\\local\\")
        || lowered.contains("\\com.amiri.amverge\\episodes\\")
}

#[cfg(target_os = "windows")]
fn sanitize_stage_file_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect();

    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "clip".to_string()
    } else {
        trimmed.chars().take(24).collect()
    }
}

#[cfg(target_os = "windows")]
fn stage_windows_editor_import_paths(
    editor_slug: &str,
    media_paths: &[String],
) -> Result<Vec<String>, String> {
    stage_windows_editor_import_paths_inner(editor_slug, media_paths, false)
}

#[cfg(target_os = "windows")]
fn stage_windows_editor_import_paths_forced(
    editor_slug: &str,
    media_paths: &[String],
) -> Result<Vec<String>, String> {
    stage_windows_editor_import_paths_inner(editor_slug, media_paths, true)
}

#[cfg(target_os = "windows")]
fn stage_windows_editor_import_paths_inner(
    editor_slug: &str,
    media_paths: &[String],
    force_stage: bool,
) -> Result<Vec<String>, String> {
    if media_paths.is_empty() {
        return Err("No media paths were provided for editor import.".to_string());
    }

    let should_stage = force_stage
        || media_paths
            .iter()
            .any(|path| should_stage_windows_editor_import_path(path));

    if !should_stage {
        return Ok(media_paths.to_vec());
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let mut stage_dir = script_runtime_dir()
        .join("staged_media")
        .join(editor_slug.trim().to_ascii_lowercase());
    stage_dir.push(format!("{}_{}", std::process::id(), ts));
    fs::create_dir_all(&stage_dir).map_err(|e| {
        format!(
            "Failed to create staging directory for editor import ({}): {e}",
            stage_dir.display()
        )
    })?;

    let mut staged_paths = Vec::with_capacity(media_paths.len());
    for (idx, raw) in media_paths.iter().enumerate() {
        let normalized = normalize_windows_editor_import_path(raw);
        if normalized.is_empty() {
            return Err("Encountered empty media path during editor import staging.".to_string());
        }

        let source = PathBuf::from(&normalized);
        if !source.exists() {
            return Err(format!(
                "Media path does not exist for editor import: {}",
                source.display()
            ));
        }

        let extension = source
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .filter(|ext| !ext.is_empty())
            .unwrap_or_else(|| "bin".to_string());
        let stem = source
            .file_stem()
            .and_then(|name| name.to_str())
            .map(sanitize_stage_file_stem)
            .unwrap_or_else(|| "clip".to_string());
        let staged_file_name = format!("{:04}_{}.{}", idx + 1, stem, extension);
        let staged = stage_dir.join(staged_file_name);

        if fs::hard_link(&source, &staged).is_err() {
            fs::copy(&source, &staged).map_err(|e| {
                format!(
                    "Failed to stage media for editor import ({} -> {}): {e}",
                    source.display(),
                    staged.display()
                )
            })?;
        }

        staged_paths.push(staged.to_string_lossy().to_string());
    }

    Ok(staged_paths)
}

#[cfg(target_os = "windows")]
fn escape_ps_single_quoted(raw: &str) -> String {
    raw.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn resolve_afterfx_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_AFTERFX_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    find_latest_adobe_executable(
        "Adobe After Effects",
        Path::new("Support Files").join("AfterFX.exe"),
    )
}

#[cfg(target_os = "windows")]
fn resolve_premier_pro_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_PREMIERE_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    find_latest_adobe_executable(
        "Adobe Premiere Pro",
        PathBuf::from("Adobe Premiere Pro.exe"),
    )
}

#[cfg(target_os = "windows")]
fn resolve_davinci_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_RESOLVE_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    let candidates = [
        r"C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe",
        r"C:\Program Files\blackmagic design\DaVinci Resolve\Resolve.exe",
    ];
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}

#[cfg(target_os = "windows")]
fn find_latest_adobe_executable(
    prefix: &str,
    executable_relative_path: PathBuf,
) -> Option<PathBuf> {
    let bases = [
        PathBuf::from(r"C:\Program Files\Adobe"),
        PathBuf::from(r"C:\Program Files (x86)\Adobe"),
    ];

    for base in bases {
        let Ok(entries) = fs::read_dir(&base) else {
            continue;
        };

        let mut candidates: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .filter(|path| {
                path.file_name()
                    .and_then(|n| n.to_str())
                    .map(|name| name.starts_with(prefix))
                    .unwrap_or(false)
            })
            .collect();

        candidates.sort_by(|a, b| {
            let an = a.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            let bn = b.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            an.cmp(bn)
        });

        for dir in candidates.into_iter().rev() {
            let exe = dir.join(&executable_relative_path);
            if exe.exists() {
                return Some(exe);
            }
        }
    }

    None
}
