use std::path::PathBuf;
use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::payloads::ProgressPayload;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

mod timeline_document;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimelineXmlClip {
    pub(crate) id: String,
    pub(crate) src: String,
    pub(crate) original_name: Option<String>,
    pub(crate) original_path: Option<String>,
    pub(crate) scene_index: Option<u32>,
    pub(crate) start_sec: Option<f64>,
    pub(crate) end_sec: Option<f64>,
}

#[derive(Debug, Clone)]
pub(super) struct SourceVideoMeta {
    pub(super) fps_num: u32,
    pub(super) fps_den: u32,
    pub(super) timebase: u32,
    pub(super) ntsc: bool,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) duration_sec: f64,
    pub(super) audio_sample_rate: u32,
    pub(super) audio_channels: u32,
}

#[derive(Debug, Clone)]
pub(super) struct TimelineClipSegment {
    pub(super) name: String,
    pub(super) source_in: i64,
    pub(super) source_out: i64,
    pub(super) timeline_start: i64,
    pub(super) timeline_end: i64,
}

fn parse_ffprobe_ratio(raw: Option<&str>) -> Option<(u32, u32)> {
    let text = raw?.trim();
    if text.is_empty() || text == "0/0" {
        return None;
    }

    if let Some((a, b)) = text.split_once('/') {
        let num = a.trim().parse::<u32>().ok()?;
        let den = b.trim().parse::<u32>().ok()?;
        if num == 0 || den == 0 {
            return None;
        }
        return Some((num, den));
    }

    let value = text.parse::<f64>().ok()?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }

    let scaled = (value * 1000.0).round() as u32;
    if scaled == 0 {
        return None;
    }

    Some((scaled, 1000))
}

fn parse_ffprobe_u32(value: Option<&serde_json::Value>) -> Option<u32> {
    let v = value?;
    if let Some(n) = v.as_u64() {
        return u32::try_from(n).ok();
    }
    if let Some(s) = v.as_str() {
        return s.trim().parse::<u32>().ok();
    }
    None
}

fn classify_timebase_ntsc(fps: f64) -> (u32, bool) {
    if (fps - 23.976).abs() < 0.02 {
        return (24, true);
    }
    if (fps - 29.97).abs() < 0.02 {
        return (30, true);
    }
    if (fps - 59.94).abs() < 0.02 {
        return (60, true);
    }

    let rounded = fps.round() as i64;
    let clamped = rounded.clamp(1, i64::from(u32::MAX)) as u32;
    (clamped, false)
}

fn seconds_to_frames(seconds: f64, fps_num: u32, fps_den: u32) -> i64 {
    if fps_num == 0 || fps_den == 0 {
        return 0;
    }

    let safe = if seconds.is_finite() {
        seconds.max(0.0)
    } else {
        0.0
    };

    ((safe * f64::from(fps_num) / f64::from(fps_den)).round() as i64).max(0)
}

async fn probe_source_video_meta(
    ffprobe: PathBuf,
    source_path: String,
) -> Result<SourceVideoMeta, String> {
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        cmd.args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels",
            "-of",
            "json",
            &source_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe failed while probing source media".to_string()
        } else {
            format!("ffprobe failed while probing source media: {stderr}")
        });
    }

    let root: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe JSON parse failed: {e}"))?;

    let streams = root
        .get("streams")
        .and_then(|v| v.as_array())
        .ok_or("ffprobe output missing streams")?;

    let video = streams
        .iter()
        .find(|v| v.get("codec_type").and_then(|x| x.as_str()) == Some("video"))
        .ok_or("No video stream found in source media")?;

    let audio = streams
        .iter()
        .find(|v| v.get("codec_type").and_then(|x| x.as_str()) == Some("audio"));

    let fps_ratio = parse_ffprobe_ratio(video.get("avg_frame_rate").and_then(|v| v.as_str()))
        .or_else(|| parse_ffprobe_ratio(video.get("r_frame_rate").and_then(|v| v.as_str())))
        .unwrap_or((30, 1));

    let fps_num = fps_ratio.0.max(1);
    let fps_den = fps_ratio.1.max(1);
    let fps = f64::from(fps_num) / f64::from(fps_den);
    let (timebase, ntsc) = classify_timebase_ntsc(fps);

    let width = parse_ffprobe_u32(video.get("width")).unwrap_or(1920).max(1);
    let height = parse_ffprobe_u32(video.get("height"))
        .unwrap_or(1080)
        .max(1);

    let duration_sec = root
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(0.0);

    let audio_sample_rate =
        parse_ffprobe_u32(audio.and_then(|a| a.get("sample_rate"))).unwrap_or(48000);
    let audio_channels = parse_ffprobe_u32(audio.and_then(|a| a.get("channels")))
        .unwrap_or(2)
        .max(1);

    Ok(SourceVideoMeta {
        fps_num,
        fps_den,
        timebase,
        ntsc,
        width,
        height,
        duration_sec,
        audio_sample_rate,
        audio_channels,
    })
}

#[tauri::command]
pub async fn export_timeline_xml(
    app: AppHandle,
    clips: Vec<TimelineXmlClip>,
    save_path: String,
    sequence_name: Option<String>,
) -> Result<(), String> {
    if clips.is_empty() {
        return Err("No clips selected for XML export".to_string());
    }

    let _ = app.emit(
        "scene_progress",
        ProgressPayload {
            percent: 5,
            message: "Generating XML timeline...".to_string(),
        },
    );

    let first = clips.first().ok_or("No clips selected for XML export")?;
    let original_path = first
        .original_path
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or("Missing original media path in clip metadata. Re-import the episode and retry XML export.")?
        .to_string();

    for clip in &clips {
        if let Some(candidate) = clip
            .original_path
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            if candidate != original_path {
                return Err(
                    "Selected clips do not reference the same original media file".to_string(),
                );
            }
        }
    }

    let source_path = PathBuf::from(&original_path);
    if !source_path.exists() {
        return Err(format!(
            "Original media file no longer exists: {}",
            source_path.display()
        ));
    }

    let mut output_path = PathBuf::from(&save_path);
    if output_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| !e.eq_ignore_ascii_case("xml"))
        .unwrap_or(true)
    {
        output_path.set_extension("xml");
    }

    if let Some(parent) = output_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    let source_meta = probe_source_video_meta(ffprobe, original_path.clone()).await?;

    let mut ordered = clips;
    ordered.sort_by(|a, b| {
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

    let fps = f64::from(source_meta.fps_num) / f64::from(source_meta.fps_den);
    let mut timeline_cursor = 0_i64;
    let mut segments: Vec<TimelineClipSegment> = Vec::with_capacity(ordered.len());

    for (idx, clip) in ordered.iter().enumerate() {
        let start_sec = clip.start_sec.ok_or(
            "Clip cut metadata is incomplete. Re-import this episode before exporting XML.",
        )?;

        let next_start = ordered.get(idx + 1).and_then(|c| c.start_sec);
        let mut end_sec = clip
            .end_sec
            .or(next_start)
            .unwrap_or(source_meta.duration_sec);

        if !end_sec.is_finite() || end_sec <= start_sec {
            end_sec = start_sec + (1.0 / fps.max(1.0));
        }

        if source_meta.duration_sec > 0.0 {
            end_sec = end_sec.min(source_meta.duration_sec);
        }

        let source_in = seconds_to_frames(start_sec, source_meta.fps_num, source_meta.fps_den);
        let mut source_out = seconds_to_frames(end_sec, source_meta.fps_num, source_meta.fps_den);
        if source_out <= source_in {
            source_out = source_in + 1;
        }

        let duration = source_out - source_in;
        let timeline_start = timeline_cursor;
        let timeline_end = timeline_start + duration;
        timeline_cursor = timeline_end;

        let name = clip
            .original_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .unwrap_or_else(|| file_name_only(&clip.src));

        segments.push(TimelineClipSegment {
            name,
            source_in,
            source_out,
            timeline_start,
            timeline_end,
        });
    }

    if segments.is_empty() {
        return Err("No valid segments could be built for XML export".to_string());
    }

    let sequence_duration = timeline_cursor.max(1);
    let source_total_frames = if source_meta.duration_sec > 0.0 {
        seconds_to_frames(
            source_meta.duration_sec,
            source_meta.fps_num,
            source_meta.fps_den,
        )
        .max(1)
    } else {
        segments
            .iter()
            .map(|s| s.source_out)
            .max()
            .unwrap_or(1)
            .max(1)
    };

    let final_sequence_name = sequence_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .or_else(|| {
            output_path
                .file_stem()
                .and_then(|v| v.to_str())
                .map(|v| v.to_string())
        })
        .unwrap_or_else(|| "AMVerge XML Timeline".to_string());

    let xml = timeline_document::build_timeline_xml_document(
        &source_meta,
        &segments,
        &source_path,
        &final_sequence_name,
        source_total_frames,
        sequence_duration,
    );

    std::fs::write(&output_path, xml).map_err(|e| format!("Failed to write XML file: {e}"))?;

    let _ = app.emit(
        "scene_progress",
        ProgressPayload {
            percent: 100,
            message: "XML export complete".to_string(),
        },
    );

    console_log(
        "EXPORT_XML|ok",
        &format!(
            "clips={} source={} output={}",
            segments.len(),
            file_name_only(&original_path),
            file_name_only(&output_path.to_string_lossy())
        ),
    );

    Ok(())
}
