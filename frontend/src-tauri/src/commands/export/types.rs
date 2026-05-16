use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::AppHandle;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptionsPayload {
    pub(super) profile_id: String,
    pub(super) workflow: String,
    pub(super) editor_target: String,
    pub(super) codec: String,
    pub(super) audio_mode: String,
    pub(super) hardware_mode: String,
    pub(super) parallel_exports: u8,
}

impl ExportOptionsPayload {
    pub(super) fn workflow(&self) -> &str {
        &self.workflow
    }

    pub(super) fn parallel_exports(&self) -> usize {
        self.parallel_exports.max(1) as usize
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NvidiaEncoderDetectionPayload {
    pub has_nvidia_gpu: bool,
    pub gpu_name: Option<String>,
    pub profile: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuEncoderCapabilitiesPayload {
    pub has_gpu_encoder: bool,
    pub preferred_backend: String,
    pub available_backends: Vec<String>,
    pub available_video_encoders: Vec<String>,
    pub h264_encoder: Option<String>,
    pub h265_encoder: Option<String>,
    pub av1_encoder: Option<String>,
    pub max_parallel_exports: u8,
}

impl Default for GpuEncoderCapabilitiesPayload {
    fn default() -> Self {
        Self {
            has_gpu_encoder: false,
            preferred_backend: "none".to_string(),
            available_backends: Vec::new(),
            available_video_encoders: Vec::new(),
            h264_encoder: None,
            h265_encoder: None,
            av1_encoder: None,
            max_parallel_exports: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct ClipExportJob {
    pub index: usize,
    pub total: usize,
    pub input: String,
    pub output: String,
    pub copy_ok: bool,
    pub input_seek_ms: Option<u64>,
    pub clip_total: Option<u64>,
}

#[derive(Clone)]
pub(super) struct ExportRuntime {
    pub app: AppHandle,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub abort_requested: Arc<AtomicBool>,
    pub active_pids: Arc<Mutex<Vec<u32>>>,
    pub export_options: Option<ExportOptionsPayload>,
    pub gpu_capabilities: GpuEncoderCapabilitiesPayload,
    pub export_start_time: Instant,
    pub remux_workflow: bool,
    pub force_encode_workflow: bool,
    pub source_video_codec: Option<String>,
}
