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
    pub export_start_time: Instant,
    pub remux_workflow: bool,
    pub force_encode_workflow: bool,
}
