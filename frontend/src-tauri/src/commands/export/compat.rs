fn normalize_codec(raw_codec: &str) -> &str {
    match raw_codec {
        "h264" => "h264_high",
        "h265" => "h265_main",
        "av1" => "av1_main",
        other => other,
    }
}

fn codec_family(codec: &str) -> &'static str {
    let c = normalize_codec(codec);
    if c.starts_with("h264_") {
        "h264"
    } else if c.starts_with("h265_") {
        "h265"
    } else if c == "av1_main" {
        "av1"
    } else if c.starts_with("prores_") {
        "prores"
    } else {
        "h264"
    }
}

pub(super) fn is_codec_container_compatible(codec: &str, container: &str) -> bool {
    let fam = codec_family(codec);
    match container {
        "mp4" => matches!(fam, "h264" | "h265" | "av1"),
        "mov" => matches!(fam, "h264" | "h265" | "av1" | "prores"),
        "mkv" => true,
        "mxf" => matches!(fam, "prores"),
        _ => true,
    }
}

pub(super) fn recommended_container_for_codec(codec: &str) -> &'static str {
    match codec_family(codec) {
        "prores" => "mov",
        _ => "mp4",
    }
}

pub(super) fn audio_copy_safe_for_container(audio_codec: &str, container: &str) -> bool {
    let codec = audio_codec.trim().to_ascii_lowercase();
    if codec.is_empty() {
        return true;
    }
    match container {
        "mp4" | "m4v" | "m4a" => matches!(
            codec.as_str(),
            "aac" | "ac3" | "eac3" | "mp3" | "alac" | "opus"
        ),
        "mov" => matches!(
            codec.as_str(),
            "aac"
                | "ac3"
                | "eac3"
                | "mp3"
                | "alac"
                | "pcm_s16le"
                | "pcm_s16be"
                | "pcm_s24le"
                | "pcm_s24be"
                | "pcm_s32le"
                | "pcm_f32le"
                | "qdm2"
        ),
        "mkv" | "webm" => true,
        _ => true,
    }
}

pub(super) fn fallback_audio_mode_for_container(container: &str) -> &'static str {
    match container {
        "mp4" | "mov" | "m4v" | "m4a" => "aac",
        "mkv" | "webm" => "copy",
        _ => "aac",
    }
}

pub(super) fn append_container_codec_tag(args: &mut Vec<String>, codec: &str, ext: &str) {
    let c = normalize_codec(codec);
    let e = ext.to_ascii_lowercase();
    if (e == "mp4" || e == "mov") && c.starts_with("h265_") {
        args.push("-tag:v".to_string());
        args.push("hvc1".to_string());
    } else if e == "mov" && c == "av1_main" {
        args.push("-tag:v".to_string());
        args.push("av01".to_string());
    }
}

pub(super) fn stream_copy_bsf_for(
    source_video_codec: Option<&str>,
    target_container: &str,
) -> Option<&'static str> {
    let needs_annexb = !matches!(
        target_container,
        "mp4" | "mov" | "m4v" | "m4a" | "3gp" | "3g2"
    );
    if !needs_annexb {
        return None;
    }
    let codec = source_video_codec?.trim().to_ascii_lowercase();
    match codec.as_str() {
        "h264" | "avc" | "avc1" => Some("h264_mp4toannexb"),
        "hevc" | "h265" | "hvc1" | "hev1" => Some("hevc_mp4toannexb"),
        _ => None,
    }
}
