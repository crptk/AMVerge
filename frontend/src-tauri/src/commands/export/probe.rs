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

pub(super) async fn probe_audio_codec_name(
    ffprobe: PathBuf,
    path: String,
) -> Result<Option<String>, String> {
    ffprobe_codec_name(ffprobe, path, "a:0").await
}

pub(super) async fn probe_video_codec_name(
    ffprobe: PathBuf,
    path: String,
) -> Result<Option<String>, String> {
    ffprobe_codec_name(ffprobe, path, "v:0").await
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

pub(super) async fn clip_first_presented_frame_is_key(
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
                "-show_frames",
                "-show_entries",
                "frame=key_frame,best_effort_timestamp_time,pict_type",
                "-of",
                "csv=p=0",
                &path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

        if !out.status.success() {
            return Ok(None);
        }

        let stdout_text = String::from_utf8_lossy(&out.stdout);
        for line in stdout_text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let mut parts = trimmed.split(',');
            let key_part = parts.next().map(str::trim).unwrap_or("");
            let ts_part = parts.next().map(str::trim).unwrap_or("");
            let pict_part = parts.next().map(str::trim).unwrap_or("");
            if key_part.is_empty() || ts_part.is_empty() || pict_part.is_empty() {
                continue;
            }

            let ts = match ts_part.parse::<f64>() {
                Ok(value) if value.is_finite() => value,
                _ => continue,
            };

            // Ignore decode preroll frames with negative presentation timestamp.
            if ts < 0.0 {
                continue;
            }

            let is_key = key_part == "1";
            let pict = pict_part.to_ascii_uppercase();
            let is_i = pict.starts_with('I');
            return Ok(Some(is_key && is_i));
        }

        Ok(None)
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))?
}

pub(super) async fn clip_first_video_packet_is_copy_safe(
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
                "packet=pts_time,dts_time,flags",
                "-of",
                "csv=p=0",
                "-read_intervals",
                "%+#1",
                &path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

        if !out.status.success() {
            return Ok(None);
        }

        let stdout_text = String::from_utf8_lossy(&out.stdout);
        let Some(first) = stdout_text
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
        else {
            return Ok(None);
        };

        let mut parts = first.split(',');
        let pts_part = parts.next().map(str::trim).unwrap_or("");
        let dts_part = parts.next().map(str::trim).unwrap_or("");
        let flags = parts.next().map(str::trim).unwrap_or("");

        let parse_time = |raw: &str| -> Option<f64> {
            if raw.eq_ignore_ascii_case("n/a") {
                return None;
            }
            raw.parse::<f64>().ok().filter(|value| value.is_finite())
        };

        let Some(pts) = parse_time(pts_part) else {
            return Ok(None);
        };
        let Some(dts) = parse_time(dts_part) else {
            return Ok(None);
        };
        let has_key = flags.contains('K');
        let has_discard = flags.contains('D');
        let non_negative = pts >= -0.000_001 && dts >= -0.000_001;

        Ok(Some(has_key && !has_discard && non_negative))
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
