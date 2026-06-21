use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub percent: u8,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct ConsoleLogPayload {
    pub source: String,
    pub level: String,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct InitialClipsPayload {
    pub clips_json: String,
}

#[derive(Serialize, Clone)]
pub struct ThumbnailReadyPayload {
    pub position: u32,
}

#[derive(Serialize, Clone)]
pub struct ClipReadyPayload {
    pub scene_index: u32,
    /// Absolute path to the cut clip, or None if cutting failed.
    pub clip_path: Option<String>,
    pub clip_mode: String,
}

#[derive(Serialize, Clone)]
pub struct PairResultPayload {
    pub pos_a: u32,
    pub pos_b: u32,
    pub should_merge: bool,
}

#[derive(Serialize, Clone)]
pub struct ReencodeProgressPayload {
    pub done: u32,
    pub total: u32,
}
