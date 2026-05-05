use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use crate::payloads::ProgressPayload;

pub(super) fn format_elapsed(start_time: Instant) -> String {
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

pub(super) fn emit_export_progress(
    app: &AppHandle,
    percent: u8,
    message: &str,
    start_time: Instant,
) {
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

pub(super) fn export_canceled_error() -> String {
    "AMVERGE_CANCELED: Export canceled by user.".to_string()
}

pub(super) fn is_canceled_error_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("amverge_canceled") || lower.contains("canceled by user")
}

pub(super) fn is_export_cancel_requested(abort_requested: &Arc<AtomicBool>) -> bool {
    abort_requested.load(Ordering::SeqCst)
}
