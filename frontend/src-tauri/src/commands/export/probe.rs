use std::path::PathBuf;
use std::process::Command;

use crate::utils::process::apply_no_window;

fn parse_seconds_to_ms(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let secs: f64 = trimmed.parse().ok()?;
    if !secs.is_finite() || secs < 0.0 {
        return None;
    }

    Some((secs * 1000.0).round() as u64)
}

pub(super) async fn ffprobe_duration_ms(
    ffprobe: PathBuf,
    path: String,
) -> Result<Option<u64>, String> {
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

        let s = String::from_utf8_lossy(&out.stdout);
        let ms = parse_seconds_to_ms(&s).ok_or("ffprobe duration parse failed".to_string())?;
        if ms == 0 {
            return Ok(None);
        }
        Ok(Some(ms))
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

pub(super) async fn is_ae_copy_safe(ffprobe: PathBuf, clip_path: String) -> Result<bool, String> {
    let v = ffprobe_codec_name(ffprobe.clone(), clip_path.clone(), "v:0").await?;
    if v.as_deref() != Some("h264") {
        return Ok(false);
    }
    let a = ffprobe_codec_name(ffprobe, clip_path, "a:0").await?;
    Ok(a.is_none() || a.as_deref() == Some("aac"))
}

pub(super) async fn clip_starts_with_keyframe(
    ffprobe: PathBuf,
    path: String,
) -> Result<Option<bool>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        let out = cmd
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "frame=key_frame",
                "-of",
                "default=nk=1:nw=1",
                "-read_intervals",
                "0%+0.20",
                &path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

        if !out.status.success() {
            return Ok(None);
        }

        let stdout_text = String::from_utf8_lossy(&out.stdout);
        let first = stdout_text
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty());

        Ok(first.map(|line| line == "1"))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))?
}

pub(super) async fn clip_video_start_ms(
    ffprobe: PathBuf,
    path: String,
) -> Result<Option<u64>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        let out = cmd
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=start_time",
                "-of",
                "default=nk=1:nw=1",
                &path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

        if !out.status.success() {
            return Ok(None);
        }

        let stdout_text = String::from_utf8_lossy(&out.stdout);
        let first = stdout_text
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty());

        Ok(first.and_then(parse_seconds_to_ms))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))?
}
