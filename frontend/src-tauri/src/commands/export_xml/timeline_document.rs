use std::path::Path;

use super::{SourceVideoMeta, TimelineClipSegment};

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

pub(super) fn build_timeline_xml_document(
    source_meta: &SourceVideoMeta,
    segments: &[TimelineClipSegment],
    source_path: &Path,
    final_sequence_name: &str,
    source_total_frames: i64,
    sequence_duration: i64,
) -> String {
    let escaped_sequence_name = xml_escape(final_sequence_name);
    let escaped_source_name = xml_escape(
        source_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("source"),
    );
    let source_url = xml_escape(&path_to_file_url(source_path));
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
    xml
}
