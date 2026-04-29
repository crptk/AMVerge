use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::payloads::ProgressPayload;
use crate::utils::ffmpeg::resolve_bundled_tool;
use crate::utils::logging::console_log;
use crate::utils::paths::file_name_only;
use crate::utils::process::apply_no_window;

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
struct SourceVideoMeta {
    fps_num: u32,
    fps_den: u32,
    timebase: u32,
    ntsc: bool,
    width: u32,
    height: u32,
    duration_sec: f64,
    audio_sample_rate: u32,
    audio_channels: u32,
}

#[derive(Debug, Clone)]
struct TimelineClipSegment {
    name: String,
    source_in: i64,
    source_out: i64,
    timeline_start: i64,
    timeline_end: i64,
}

fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn percent_encode_uri_path(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 16);

    for &b in raw.as_bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '/' | ':' | '.' | '-' | '_' | '~') {
            out.push(c);
        } else {
            out.push('%');
            out.push_str(&format!("{b:02X}"));
        }
    }

    out
}

fn path_to_file_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let encoded = percent_encode_uri_path(&normalized);

    // Premiere is strict on Windows pathurl shape in FCP7 XML.
    // Prefer file://localhost/C%3a/... over more relaxed variants.
    if normalized.len() >= 3 {
        let bytes = normalized.as_bytes();
        let drive = bytes[0] as char;
        let has_drive_colon = drive.is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
        if has_drive_colon {
            let drive_letter = drive.to_ascii_uppercase();
            let rest = &normalized[2..];
            let encoded_rest = percent_encode_uri_path(rest);
            return format!("file://localhost/{}%3a{}", drive_letter, encoded_rest);
        }
    }

    if normalized.starts_with("//") {
        return format!("file://localhost{encoded}");
    }

    format!("file://localhost///{}", encoded.trim_start_matches('/'))
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

    let escaped_sequence_name = xml_escape(&final_sequence_name);
    let escaped_source_name = xml_escape(
        source_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("source"),
    );
    let source_url = xml_escape(&path_to_file_url(&source_path));
    let ntsc = if source_meta.ntsc { "TRUE" } else { "FALSE" };
    let reported_audio_channels = source_meta.audio_channels.max(1);
    let audio_layout = if reported_audio_channels == 1 {
        "mono"
    } else {
        "stereo"
    };

    let mut shared_file_block = String::new();
    shared_file_block.push_str("            <file id=\"file-1\">\n");
    shared_file_block.push_str(&format!(
        "              <name>{}</name>\n",
        escaped_source_name
    ));
    shared_file_block.push_str(&format!(
        "              <pathurl>{}</pathurl>\n",
        source_url
    ));
    shared_file_block.push_str("              <rate>\n");
    shared_file_block.push_str(&format!(
        "                <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    shared_file_block.push_str(&format!("                <ntsc>{}</ntsc>\n", ntsc));
    shared_file_block.push_str("              </rate>\n");
    shared_file_block.push_str(&format!(
        "              <duration>{}</duration>\n",
        source_total_frames
    ));
    shared_file_block.push_str("              <timecode>\n");
    shared_file_block.push_str("                <rate>\n");
    shared_file_block.push_str(&format!(
        "                  <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    shared_file_block.push_str(&format!("                  <ntsc>{}</ntsc>\n", ntsc));
    shared_file_block.push_str("                </rate>\n");
    shared_file_block.push_str("                <string>00:00:00:00</string>\n");
    shared_file_block.push_str("                <frame>0</frame>\n");
    shared_file_block.push_str("                <displayformat>NDF</displayformat>\n");
    shared_file_block.push_str("              </timecode>\n");
    shared_file_block.push_str("              <media>\n");
    shared_file_block.push_str("                <video>\n");
    shared_file_block.push_str("                  <samplecharacteristics>\n");
    shared_file_block.push_str("                    <rate>\n");
    shared_file_block.push_str(&format!(
        "                      <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    shared_file_block.push_str(&format!("                      <ntsc>{}</ntsc>\n", ntsc));
    shared_file_block.push_str("                    </rate>\n");
    shared_file_block.push_str(&format!(
        "                    <width>{}</width>\n",
        source_meta.width
    ));
    shared_file_block.push_str(&format!(
        "                    <height>{}</height>\n",
        source_meta.height
    ));
    shared_file_block.push_str("                    <pixelaspectratio>square</pixelaspectratio>\n");
    shared_file_block.push_str("                    <fielddominance>none</fielddominance>\n");
    shared_file_block.push_str("                  </samplecharacteristics>\n");
    shared_file_block.push_str("                </video>\n");
    shared_file_block.push_str("                <audio>\n");
    shared_file_block.push_str("                  <samplecharacteristics>\n");
    shared_file_block.push_str("                    <depth>16</depth>\n");
    shared_file_block.push_str(&format!(
        "                    <samplerate>{}</samplerate>\n",
        source_meta.audio_sample_rate
    ));
    shared_file_block.push_str("                  </samplecharacteristics>\n");
    shared_file_block.push_str(&format!(
        "                  <channelcount>{}</channelcount>\n",
        source_meta.audio_channels
    ));
    shared_file_block.push_str(&format!(
        "                  <layout>{}</layout>\n",
        audio_layout
    ));
    for ch in 1..=reported_audio_channels {
        shared_file_block.push_str("                  <audiochannel>\n");
        shared_file_block.push_str(&format!(
            "                    <sourcechannel>{}</sourcechannel>\n",
            ch
        ));
        let label = match ch {
            1 => "left",
            2 => "right",
            _ => "mono",
        };
        shared_file_block.push_str(&format!(
            "                    <channellabel>{}</channellabel>\n",
            label
        ));
        shared_file_block.push_str("                  </audiochannel>\n");
    }
    shared_file_block.push_str("                </audio>\n");
    shared_file_block.push_str("              </media>\n");
    shared_file_block.push_str("            </file>\n");

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<!DOCTYPE xmeml>\n");
    xml.push_str("<xmeml version=\"5\">\n");
    xml.push_str("  <sequence>\n");
    xml.push_str(&format!("    <name>{}</name>\n", escaped_sequence_name));
    xml.push_str("    <rate>\n");
    xml.push_str(&format!(
        "      <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    xml.push_str(&format!("      <ntsc>{}</ntsc>\n", ntsc));
    xml.push_str("    </rate>\n");
    xml.push_str(&format!("    <duration>{}</duration>\n", sequence_duration));
    xml.push_str("    <media>\n");
    xml.push_str("      <video>\n");
    xml.push_str("        <format>\n");
    xml.push_str("          <samplecharacteristics>\n");
    xml.push_str("            <rate>\n");
    xml.push_str(&format!(
        "              <timebase>{}</timebase>\n",
        source_meta.timebase
    ));
    xml.push_str(&format!("              <ntsc>{}</ntsc>\n", ntsc));
    xml.push_str("            </rate>\n");
    xml.push_str(&format!(
        "            <width>{}</width>\n",
        source_meta.width
    ));
    xml.push_str(&format!(
        "            <height>{}</height>\n",
        source_meta.height
    ));
    xml.push_str("            <pixelaspectratio>square</pixelaspectratio>\n");
    xml.push_str("            <fielddominance>none</fielddominance>\n");
    xml.push_str("          </samplecharacteristics>\n");
    xml.push_str("        </format>\n");
    xml.push_str("        <track>\n");
    xml.push_str("          <enabled>TRUE</enabled>\n");
    xml.push_str("          <locked>FALSE</locked>\n");

    for (idx, segment) in segments.iter().enumerate() {
        let clip_ordinal = idx + 1;
        let video_clip_id = format!("clipitem-v-{clip_ordinal}");
        let audio_clip_id = format!("clipitem-a-{clip_ordinal}");
        let clip_name = xml_escape(&segment.name);
        let clip_duration = (segment.timeline_end - segment.timeline_start).max(1);
        xml.push_str(&format!("          <clipitem id=\"{}\">\n", video_clip_id));
        xml.push_str(&format!("            <name>{}</name>\n", clip_name));
        xml.push_str("            <enabled>TRUE</enabled>\n");
        xml.push_str("            <rate>\n");
        xml.push_str(&format!(
            "              <timebase>{}</timebase>\n",
            source_meta.timebase
        ));
        xml.push_str(&format!("              <ntsc>{}</ntsc>\n", ntsc));
        xml.push_str("            </rate>\n");
        xml.push_str(&format!(
            "            <start>{}</start>\n",
            segment.timeline_start
        ));
        xml.push_str(&format!(
            "            <end>{}</end>\n",
            segment.timeline_end
        ));
        xml.push_str(&format!(
            "            <duration>{}</duration>\n",
            clip_duration
        ));
        xml.push_str(&format!("            <in>{}</in>\n", segment.source_in));
        xml.push_str(&format!("            <out>{}</out>\n", segment.source_out));

        if idx == 0 {
            xml.push_str(&shared_file_block);
        } else {
            xml.push_str("            <file id=\"file-1\"/>\n");
        }

        xml.push_str("            <sourcetrack>\n");
        xml.push_str("              <mediatype>video</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str("            </sourcetrack>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            video_clip_id
        ));
        xml.push_str("              <mediatype>video</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("            </link>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            audio_clip_id
        ));
        xml.push_str("              <mediatype>audio</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("              <groupindex>1</groupindex>\n");
        xml.push_str("            </link>\n");
        xml.push_str("          </clipitem>\n");
    }

    xml.push_str("        </track>\n");
    xml.push_str("      </video>\n");
    xml.push_str("      <audio>\n");
    xml.push_str("        <format>\n");
    xml.push_str("          <samplecharacteristics>\n");
    xml.push_str("            <depth>16</depth>\n");
    xml.push_str(&format!(
        "            <samplerate>{}</samplerate>\n",
        source_meta.audio_sample_rate
    ));
    xml.push_str("          </samplecharacteristics>\n");
    xml.push_str(&format!(
        "          <channelcount>{}</channelcount>\n",
        source_meta.audio_channels
    ));
    xml.push_str(&format!("          <layout>{}</layout>\n", audio_layout));
    xml.push_str("        </format>\n");
    xml.push_str("        <track>\n");
    xml.push_str("          <enabled>TRUE</enabled>\n");
    xml.push_str("          <locked>FALSE</locked>\n");

    for (idx, segment) in segments.iter().enumerate() {
        let clip_ordinal = idx + 1;
        let video_clip_id = format!("clipitem-v-{clip_ordinal}");
        let audio_clip_id = format!("clipitem-a-{clip_ordinal}");
        let clip_name = xml_escape(&segment.name);
        let clip_duration = (segment.timeline_end - segment.timeline_start).max(1);
        xml.push_str(&format!("          <clipitem id=\"{}\">\n", audio_clip_id));
        xml.push_str(&format!("            <name>{}</name>\n", clip_name));
        xml.push_str("            <enabled>TRUE</enabled>\n");
        xml.push_str("            <rate>\n");
        xml.push_str(&format!(
            "              <timebase>{}</timebase>\n",
            source_meta.timebase
        ));
        xml.push_str(&format!("              <ntsc>{}</ntsc>\n", ntsc));
        xml.push_str("            </rate>\n");
        xml.push_str(&format!(
            "            <start>{}</start>\n",
            segment.timeline_start
        ));
        xml.push_str(&format!(
            "            <end>{}</end>\n",
            segment.timeline_end
        ));
        xml.push_str(&format!(
            "            <duration>{}</duration>\n",
            clip_duration
        ));
        xml.push_str(&format!("            <in>{}</in>\n", segment.source_in));
        xml.push_str(&format!("            <out>{}</out>\n", segment.source_out));
        if idx == 0 {
            xml.push_str(&shared_file_block);
        } else {
            xml.push_str("            <file id=\"file-1\"/>\n");
        }
        xml.push_str("            <sourcetrack>\n");
        xml.push_str("              <mediatype>audio</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str("            </sourcetrack>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            video_clip_id
        ));
        xml.push_str("              <mediatype>video</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("            </link>\n");
        xml.push_str("            <link>\n");
        xml.push_str(&format!(
            "              <linkclipref>{}</linkclipref>\n",
            audio_clip_id
        ));
        xml.push_str("              <mediatype>audio</mediatype>\n");
        xml.push_str("              <trackindex>1</trackindex>\n");
        xml.push_str(&format!(
            "              <clipindex>{}</clipindex>\n",
            clip_ordinal
        ));
        xml.push_str("              <groupindex>1</groupindex>\n");
        xml.push_str("            </link>\n");
        xml.push_str("          </clipitem>\n");
    }

    xml.push_str("        </track>\n");
    xml.push_str("      </audio>\n");
    xml.push_str("    </media>\n");
    xml.push_str("  </sequence>\n");
    xml.push_str("</xmeml>\n");

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
