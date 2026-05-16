use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::Mutex;

use tauri::{AppHandle, State};

use crate::state::{ActiveFfmpegPids, ExportAbortState};
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;

mod compat;
mod encode;
mod hardware;
mod merge;
mod multi;
mod ops;
mod probe;
mod progress;
mod runner;
mod types;

pub use types::{
    ExportOptionsPayload, GpuEncoderCapabilitiesPayload, NvidiaEncoderDetectionPayload,
};

use types::ExportRuntime;

struct ExportAbortGuard {
    abort_requested: Arc<std::sync::atomic::AtomicBool>,
    active_pids: Arc<Mutex<Vec<u32>>>,
}

impl Drop for ExportAbortGuard {
    fn drop(&mut self) {
        self.abort_requested.store(false, Ordering::SeqCst);
        if let Ok(mut lock) = self.active_pids.lock() {
            lock.clear();
        }
    }
}

/// Reject paths whose final component contains path separators / parent refs
/// after the Tauri save dialog (or programmatic caller) has resolved the path.
/// This prevents path-traversal injection via a user-supplied merge filename.
fn validate_save_path_filename(path: &std::path::Path) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Output path has no file name component.".to_string())?;
    if file_name.is_empty() {
        return Err("Output file name is empty.".into());
    }
    if file_name == "." || file_name == ".." {
        return Err("Output file name is invalid.".into());
    }
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains('\0') {
        return Err("Output file name contains invalid characters.".into());
    }
    Ok(())
}

/// Remove `path` if it exists and is empty (0 bytes). Used after ffmpeg failure
/// to avoid leaving misleading 0 KB output files behind.
fn cleanup_empty_output(path: &std::path::Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.is_file() && meta.len() == 0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn normalize_save_path(save_path: &str) -> Result<PathBuf, String> {
    let mut path = PathBuf::from(save_path);

    if path.extension().is_none() {
        path.set_extension("mp4");
    }

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    Ok(path)
}

#[tauri::command]
pub async fn export_clips(
    app: AppHandle,
    abort_state: State<'_, ExportAbortState>,
    clips: Vec<String>,
    save_path: String,
    merge_enabled: bool,
    export_options: Option<ExportOptionsPayload>,
) -> Result<Vec<String>, String> {
    abort_state.abort_requested.store(false, Ordering::SeqCst);
    if let Ok(mut lock) = abort_state.pids.lock() {
        lock.clear();
    }

    let abort_requested = abort_state.abort_requested.clone();
    let active_pids = abort_state.pids.clone();

    let _abort_guard = ExportAbortGuard {
        abort_requested: abort_requested.clone(),
        active_pids: active_pids.clone(),
    };

    if clips.is_empty() {
        return Ok(Vec::new());
    }

    // Preflight: every source clip path must still exist on disk. The Python
    // backend writes scene segments into a per-import UUID folder which can be
    // wiped between import and export (user cleanup, restart, etc.). Without
    // this check ffmpeg fails deep inside the concat demuxer with a cryptic
    // "No such file or directory" naming only one segment.
    {
        let mut missing: Vec<String> = Vec::new();
        for clip in &clips {
            if !std::path::Path::new(clip).exists() {
                missing.push(file_name_only(clip));
                if missing.len() >= 3 {
                    break;
                }
            }
        }
        if !missing.is_empty() {
            return Err(format!(
                "Source clip{} no longer exist{} on disk: {}. \
                 The working folder may have been deleted or moved — \
                 re-import the episode and try again.",
                if missing.len() == 1 { "" } else { "s" },
                if missing.len() == 1 { "s" } else { "" },
                missing.join(", ")
            ));
        }
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

    if let Some(options) = &export_options {
        console_log(
            "EXPORT|profile",
            &format!(
                "profile={} workflow={} editor={} codec={} audio={} hardware={} parallel={}",
                options.profile_id,
                options.workflow,
                options.editor_target,
                options.codec,
                options.audio_mode,
                options.hardware_mode,
                options.parallel_exports
            ),
        );
    }

    let workflow = export_options
        .as_ref()
        .map(|options| options.workflow())
        .unwrap_or("video_encode");
    let remux_workflow = workflow == "video_remux" || workflow == "editor_remux";
    let force_encode_workflow = workflow == "video_encode" || workflow == "editor_encode";

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    let gpu_capabilities = hardware::detect_gpu_encoder_capabilities_inner(ffmpeg.clone())
        .await
        .unwrap_or_default();

    if gpu_capabilities.has_gpu_encoder {
        console_log(
            "EXPORT|gpu",
            &format!(
                "backend={} h264={} h265={} av1={} max_parallel={}",
                gpu_capabilities.preferred_backend,
                gpu_capabilities.h264_encoder.as_deref().unwrap_or("none"),
                gpu_capabilities.h265_encoder.as_deref().unwrap_or("none"),
                gpu_capabilities.av1_encoder.as_deref().unwrap_or("none"),
                gpu_capabilities.max_parallel_exports
            ),
        );
    } else {
        console_log(
            "EXPORT|gpu",
            "no hardware video encoder available; cpu path",
        );
    }

    let normalized_save_path = normalize_save_path(&save_path)?;
    validate_save_path_filename(&normalized_save_path)?;

    let container_ext = normalized_save_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // Preflight: codec/container compatibility check + audio-copy fallback.
    let mut export_options = export_options;
    if let Some(options) = export_options.as_mut() {
        // Hard fail when the codec cannot possibly be muxed into the container.
        if !remux_workflow
            && !container_ext.is_empty()
            && !compat::is_codec_container_compatible(&options.codec, &container_ext)
        {
            let recommended = compat::recommended_container_for_codec(&options.codec);
            return Err(format!(
                "Codec '{}' is not compatible with container '.{}'. \
                 Choose container '.{}' (or another compatible one) and retry.",
                options.codec, container_ext, recommended
            ));
        }

        // Audio copy safety: probe the first clip's audio codec and switch to a
        // safe encoder when copy would fail the muxer (e.g. Opus → MOV/MP4).
        // This is the root cause of many "0 KB output" reports.
        if options.audio_mode == "copy" && !container_ext.is_empty() {
            match probe::probe_audio_codec_name(ffprobe.clone(), clips[0].clone()).await {
                Ok(Some(audio_codec)) => {
                    if !compat::audio_copy_safe_for_container(&audio_codec, &container_ext) {
                        let fallback =
                            compat::fallback_audio_mode_for_container(&container_ext).to_string();
                        console_log(
                            "EXPORT|audio",
                            &format!(
                                "audio codec '{audio_codec}' cannot be stream-copied into .{container_ext}; using '{fallback}'"
                            ),
                        );
                        options.audio_mode = fallback;
                    }
                }
                Ok(None) => {
                    // No audio stream detected; copy is a no-op, leave as is.
                }
                Err(err) => {
                    console_log(
                        "EXPORT|audio",
                        &format!("audio probe failed ({err}); leaving audio_mode=copy"),
                    );
                }
            }
        }
    }

    // Probe the source video codec once. Used to pick the right `_mp4toannexb`
    // bitstream filter for stream-copy paths into Annex-B containers
    // (MKV/WebM/AVI/TS). Without this, MP4 → MKV `-c copy` produces files that
    // VLC plays but Windows Media Foundation decodes as green/blue snow,
    // because the concat demuxer does not auto-insert the BSF.
    let source_video_codec = probe::probe_video_codec_name(ffprobe.clone(), clips[0].clone())
        .await
        .ok()
        .flatten();
    if let Some(codec) = &source_video_codec {
        console_log("EXPORT|source", &format!("video codec={codec}"));
    }

    let runtime = ExportRuntime {
        app,
        ffmpeg,
        ffprobe,
        abort_requested,
        active_pids,
        export_options,
        gpu_capabilities,
        export_start_time: std::time::Instant::now(),
        remux_workflow,
        force_encode_workflow,
        source_video_codec,
    };

    let exported_files = if merge_enabled {
        match merge::run_merge_export(&runtime, &clips, &normalized_save_path).await {
            Ok(file) => vec![file],
            Err(err) => {
                cleanup_empty_output(&normalized_save_path);
                return Err(err);
            }
        }
    } else {
        match multi::run_multi_export(&runtime, &clips, &normalized_save_path).await {
            Ok(files) => files,
            Err(err) => {
                cleanup_empty_output(&normalized_save_path);
                return Err(err);
            }
        }
    };

    console_log("EXPORT|end", "ok");

    Ok(exported_files)
}

#[tauri::command]
pub async fn detect_nvidia_encoder_profile() -> Result<NvidiaEncoderDetectionPayload, String> {
    hardware::detect_nvidia_encoder_profile_inner().await
}

#[tauri::command]
pub async fn detect_gpu_encoder_capabilities(
    app: AppHandle,
) -> Result<GpuEncoderCapabilitiesPayload, String> {
    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    hardware::detect_gpu_encoder_capabilities_inner(ffmpeg).await
}

#[tauri::command]
pub async fn fast_merge(
    app: AppHandle,
    ffmpeg_pids: State<'_, ActiveFfmpegPids>,
    clips: Vec<String>,
    output_path: String,
) -> Result<String, String> {
    ops::fast_merge_inner(app, ffmpeg_pids.pids.clone(), clips, output_path).await
}

#[tauri::command]
pub async fn fast_split(
    app: AppHandle,
    ffmpeg_pids: State<'_, ActiveFfmpegPids>,
    input_path: String,
    split_time: f64,
    output_path1: String,
    output_path2: String,
    thumb_path2: String,
) -> Result<(), String> {
    ops::fast_split_inner(
        app,
        ffmpeg_pids.pids.clone(),
        input_path,
        split_time,
        output_path1,
        output_path2,
        thumb_path2,
    )
    .await
}

#[tauri::command]
pub async fn abort_export(abort_state: State<'_, ExportAbortState>) -> Result<String, String> {
    ops::abort_export_inner(abort_state).await
}
