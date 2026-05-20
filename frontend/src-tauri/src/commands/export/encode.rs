use std::path::Path;

use super::compat::append_container_codec_tag;
use super::types::{ExportOptionsPayload, GpuEncoderCapabilitiesPayload};

fn normalize_codec(raw_codec: &str) -> &str {
    match raw_codec {
        "h264" => "h264_high",
        "h265" => "h265_main",
        "av1" => "av1_main",
        "cineform"
        | "dnxhr_lb"
        | "dnxhr_sq"
        | "dnxhr_hq"
        | "dnxhr_hqx"
        | "dnxhr_444"
        | "uncompressed_rgb8"
        | "uncompressed_rgb10"
        | "uncompressed_rgba8"
        | "uncompressed_rgba16" => "h264_high",
        other => other,
    }
}

fn is_nvenc_encoder(encoder: &str) -> bool {
    encoder.ends_with("_nvenc")
}

pub(super) fn select_gpu_encoder_for_codec<'a>(
    codec: &str,
    gpu_capabilities: &'a GpuEncoderCapabilitiesPayload,
) -> Option<&'a str> {
    let normalized_codec = normalize_codec(codec);
    if normalized_codec.starts_with("h264_") {
        return gpu_capabilities.h264_encoder.as_deref();
    }
    if normalized_codec.starts_with("h265_") {
        return gpu_capabilities.h265_encoder.as_deref();
    }
    if normalized_codec == "av1_main" {
        return gpu_capabilities.av1_encoder.as_deref();
    }
    None
}

fn append_gpu_video_encode_args(args: &mut Vec<String>, codec: &str, gpu_encoder: &str) {
    let normalized_codec = normalize_codec(codec);
    let nvenc = is_nvenc_encoder(gpu_encoder);

    match normalized_codec {
        "h264_main" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "main".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "19".into()]);
            }
        }
        "h264_high10" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "high10".into(),
                "-pix_fmt".into(),
                "p010le".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "20".into()]);
            }
        }
        "h264_high422" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "high422".into(),
                "-pix_fmt".into(),
                "yuv422p".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "20".into()]);
            }
        }
        "h265_main" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "main".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "19".into()]);
            }
        }
        "h265_main10" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "main10".into(),
                "-pix_fmt".into(),
                "p010le".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "20".into()]);
            }
        }
        "h265_main12" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "main12".into(),
                "-pix_fmt".into(),
                "yuv420p12le".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "22".into()]);
            }
        }
        "h265_main422_10" => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "main422-10".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "21".into()]);
            }
        }
        "av1_main" => {
            args.extend([
                "-c:v".into(),
                gpu_encoder.into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "28".into()]);
            }
        }
        _ => {
            args.extend(["-c:v".into(), gpu_encoder.into()]);
            args.extend([
                "-profile:v".into(),
                "high".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if nvenc {
                args.extend(["-cq".into(), "19".into()]);
            }
        }
    }
}

pub(super) fn append_video_encode_args(
    args: &mut Vec<String>,
    options: Option<&ExportOptionsPayload>,
    gpu_encoder: Option<&str>,
) {
    let raw_codec = options.map(|o| o.codec.as_str()).unwrap_or("h264_high");
    let codec = normalize_codec(raw_codec);

    let hardware_mode = options.map(|o| o.hardware_mode.as_str()).unwrap_or("cpu");
    let gpu_requested = hardware_mode == "gpu" || hardware_mode == "auto";

    if gpu_requested {
        if let Some(encoder) = gpu_encoder {
            append_gpu_video_encode_args(args, codec, encoder);
            return;
        }
    }

    match codec {
        "h264_main" => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-profile:v".into(),
                "main".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "18".into(),
            ]);
        }
        "h264_high10" => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-profile:v".into(),
                "high10".into(),
                "-pix_fmt".into(),
                "yuv420p10le".into(),
                "-preset".into(),
                "slow".into(),
                "-crf".into(),
                "19".into(),
            ]);
        }
        "h264_high422" => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-profile:v".into(),
                "high422".into(),
                "-pix_fmt".into(),
                "yuv422p".into(),
                "-preset".into(),
                "slow".into(),
                "-crf".into(),
                "18".into(),
            ]);
        }
        "h265_main" => {
            args.extend([
                "-c:v".into(),
                "libx265".into(),
                "-profile:v".into(),
                "main".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "20".into(),
            ]);
        }
        "h265_main10" => {
            args.extend([
                "-c:v".into(),
                "libx265".into(),
                "-profile:v".into(),
                "main10".into(),
                "-pix_fmt".into(),
                "yuv420p10le".into(),
                "-preset".into(),
                "slow".into(),
                "-crf".into(),
                "21".into(),
            ]);
        }
        "h265_main12" => {
            args.extend([
                "-c:v".into(),
                "libx265".into(),
                "-profile:v".into(),
                "main12".into(),
                "-pix_fmt".into(),
                "yuv420p12le".into(),
                "-preset".into(),
                "slow".into(),
                "-crf".into(),
                "22".into(),
            ]);
        }
        "h265_main422_10" => {
            args.extend([
                "-c:v".into(),
                "libx265".into(),
                "-profile:v".into(),
                "main422-10".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
                "-preset".into(),
                "slow".into(),
                "-crf".into(),
                "21".into(),
            ]);
        }
        "av1_main" => {
            args.extend([
                "-c:v".into(),
                "libsvtav1".into(),
                "-preset".into(),
                "6".into(),
                "-crf".into(),
                "32".into(),
            ]);
        }
        "prores_422_lt" => {
            args.extend([
                "-c:v".into(),
                "prores_ks".into(),
                "-profile:v".into(),
                "1".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ]);
        }
        "prores_422" => {
            args.extend([
                "-c:v".into(),
                "prores_ks".into(),
                "-profile:v".into(),
                "2".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ]);
        }
        "prores_422_hq" => {
            args.extend([
                "-c:v".into(),
                "prores_ks".into(),
                "-profile:v".into(),
                "3".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ]);
        }
        "prores_4444" => {
            args.extend([
                "-c:v".into(),
                "prores_ks".into(),
                "-profile:v".into(),
                "4".into(),
                "-pix_fmt".into(),
                "yuva444p10le".into(),
            ]);
        }
        "prores_4444_xq" => {
            args.extend([
                "-c:v".into(),
                "prores_ks".into(),
                "-profile:v".into(),
                "5".into(),
                "-pix_fmt".into(),
                "yuva444p10le".into(),
            ]);
        }
        _ => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-profile:v".into(),
                "high".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "18".into(),
            ]);
        }
    }
}

pub(super) fn append_audio_encode_args(
    args: &mut Vec<String>,
    options: Option<&ExportOptionsPayload>,
) {
    let audio_mode = options.map(|o| o.audio_mode.as_str()).unwrap_or("aac");
    match audio_mode {
        "copy" => args.extend(["-c:a".into(), "copy".into()]),
        "pcm16" => args.extend([
            "-c:a".into(),
            "pcm_s16le".into(),
            "-ar".into(),
            "48000".into(),
        ]),
        "pcm24" => args.extend([
            "-c:a".into(),
            "pcm_s24le".into(),
            "-ar".into(),
            "48000".into(),
        ]),
        "flac" => args.extend([
            "-c:a".into(),
            "flac".into(),
            "-compression_level".into(),
            "5".into(),
        ]),
        "alac" => args.extend(["-c:a".into(), "alac".into()]),
        "opus" => args.extend([
            "-c:a".into(),
            "libopus".into(),
            "-b:a".into(),
            "160k".into(),
            "-vbr".into(),
            "on".into(),
            "-application".into(),
            "audio".into(),
        ]),
        "mp3" => args.extend([
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            "320k".into(),
        ]),
        "none" => args.push("-an".into()),
        "aac_320" => args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "320k".into(),
            "-ar".into(),
            "48000".into(),
        ]),
        _ => args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ar".into(),
            "48000".into(),
        ]),
    }
}

pub(super) fn ffmpeg_reencode_args(
    input: &str,
    output: &str,
    options: Option<&ExportOptionsPayload>,
    input_seek_ms: Option<u64>,
    gpu_encoder: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["-y".to_string()];
    let output_seek = input_seek_ms.filter(|ms| *ms > 0).map(|ms| {
        let seconds = ms as f64 / 1000.0;
        let value = format!("{seconds:.6}");
        value
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    });

    // Timestamp normalization to reduce editor import edge cases.
    args.extend([
        "-i".to_string(),
        input.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a?".to_string(),
    ]);

    if let Some(seek) = output_seek {
        // Keep seek on output side for frame-accurate trimming when re-encoding.
        args.push("-ss".to_string());
        args.push(seek);
    }

    args.extend(["-vf".to_string(), "setpts=PTS-STARTPTS".to_string()]);
    let audio_mode = options.map(|o| o.audio_mode.as_str()).unwrap_or("aac");
    if audio_mode != "none" && audio_mode != "copy" {
        args.extend(["-af".to_string(), "asetpts=PTS-STARTPTS".to_string()]);
    }

    append_video_encode_args(&mut args, options, gpu_encoder);
    append_audio_encode_args(&mut args, options);
    // Force constant frame rate on re-encode outputs.
    args.extend(["-fps_mode:v:0".to_string(), "cfr".to_string()]);

    let ext = Path::new(output)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "mp4" || ext == "mov" {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }
    let codec_for_tag = options.map(|o| o.codec.as_str()).unwrap_or("h264_high");
    append_container_codec_tag(&mut args, codec_for_tag, &ext);

    args.push("-max_muxing_queue_size".to_string());
    args.push("1024".to_string());
    args.push(output.to_string());

    args
}
