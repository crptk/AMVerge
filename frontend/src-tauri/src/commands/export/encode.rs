use std::path::Path;

use super::types::ExportOptionsPayload;

pub(super) fn append_video_encode_args(
    args: &mut Vec<String>,
    options: Option<&ExportOptionsPayload>,
) {
    let raw_codec = options.map(|o| o.codec.as_str()).unwrap_or("h264_high");
    let codec = match raw_codec {
        "h264" => "h264_high",
        "h265" => "h265_main",
        "av1" => "av1_main",
        other => other,
    };

    let hardware_mode = options.map(|o| o.hardware_mode.as_str()).unwrap_or("cpu");
    let gpu_requested = hardware_mode == "gpu" || hardware_mode == "auto";
    let force_cpu_when_auto = hardware_mode == "auto"
        && matches!(
            codec,
            "h264_high10" | "h264_high422" | "h265_main12" | "h265_main422_10"
        );
    let use_gpu = gpu_requested && !force_cpu_when_auto;

    match codec {
        "h264_main" => {
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "h264_nvenc".into(),
                    "-profile:v".into(),
                    "main".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-cq".into(),
                    "19".into(),
                ]);
            } else {
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
        }
        "h264_high10" => {
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "h264_nvenc".into(),
                    "-profile:v".into(),
                    "high10".into(),
                    "-pix_fmt".into(),
                    "p010le".into(),
                    "-cq".into(),
                    "20".into(),
                ]);
            } else {
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
        }
        "h264_high422" => {
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "h264_nvenc".into(),
                    "-profile:v".into(),
                    "high422".into(),
                    "-pix_fmt".into(),
                    "yuv422p".into(),
                    "-cq".into(),
                    "20".into(),
                ]);
            } else {
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
        }
        "h265_main" => {
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "hevc_nvenc".into(),
                    "-profile:v".into(),
                    "main".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-cq".into(),
                    "19".into(),
                ]);
            } else {
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
        }
        "h265_main10" => {
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "hevc_nvenc".into(),
                    "-profile:v".into(),
                    "main10".into(),
                    "-pix_fmt".into(),
                    "p010le".into(),
                    "-cq".into(),
                    "20".into(),
                ]);
            } else {
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
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "av1_nvenc".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-cq".into(),
                    "28".into(),
                ]);
            } else {
                args.extend([
                    "-c:v".into(),
                    "libsvtav1".into(),
                    "-preset".into(),
                    "6".into(),
                    "-crf".into(),
                    "32".into(),
                ]);
            }
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
        "dnxhr_lb" => {
            args.extend([
                "-c:v".into(),
                "dnxhd".into(),
                "-profile:v".into(),
                "dnxhr_lb".into(),
                "-pix_fmt".into(),
                "yuv422p".into(),
            ]);
        }
        "dnxhr_sq" => {
            args.extend([
                "-c:v".into(),
                "dnxhd".into(),
                "-profile:v".into(),
                "dnxhr_sq".into(),
                "-pix_fmt".into(),
                "yuv422p".into(),
            ]);
        }
        "dnxhr_hq" => {
            args.extend([
                "-c:v".into(),
                "dnxhd".into(),
                "-profile:v".into(),
                "dnxhr_hq".into(),
                "-pix_fmt".into(),
                "yuv422p".into(),
            ]);
        }
        "dnxhr_hqx" => {
            args.extend([
                "-c:v".into(),
                "dnxhd".into(),
                "-profile:v".into(),
                "dnxhr_hqx".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ]);
        }
        "dnxhr_444" => {
            args.extend([
                "-c:v".into(),
                "dnxhd".into(),
                "-profile:v".into(),
                "dnxhr_444".into(),
                "-pix_fmt".into(),
                "gbrp10le".into(),
            ]);
        }
        "uncompressed_rgb8" => {
            args.extend([
                "-c:v".into(),
                "rawvideo".into(),
                "-pix_fmt".into(),
                "rgb24".into(),
            ]);
        }
        "uncompressed_rgb10" => {
            args.extend([
                "-c:v".into(),
                "rawvideo".into(),
                "-pix_fmt".into(),
                "gbrp10le".into(),
            ]);
        }
        "uncompressed_rgba8" => {
            args.extend([
                "-c:v".into(),
                "rawvideo".into(),
                "-pix_fmt".into(),
                "rgba".into(),
            ]);
        }
        "uncompressed_rgba16" => {
            args.extend([
                "-c:v".into(),
                "rawvideo".into(),
                "-pix_fmt".into(),
                "rgba64le".into(),
            ]);
        }
        "cineform" => {
            args.extend([
                "-c:v".into(),
                "cfhd".into(),
                "-quality".into(),
                "high".into(),
                "-pix_fmt".into(),
                "yuv422p10le".into(),
            ]);
        }
        _ => {
            if use_gpu {
                args.extend([
                    "-c:v".into(),
                    "h264_nvenc".into(),
                    "-profile:v".into(),
                    "high".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-cq".into(),
                    "19".into(),
                ]);
            } else {
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
            "-ac".into(),
            "2".into(),
        ]),
        "none" => args.push("-an".into()),
        _ => args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
        ]),
    }
}

pub(super) fn ffmpeg_reencode_args(
    input: &str,
    output: &str,
    options: Option<&ExportOptionsPayload>,
) -> Vec<String> {
    // Timestamp normalization to reduce editor import edge cases.
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-avoid_negative_ts".to_string(),
        "make_zero".to_string(),
    ];

    append_video_encode_args(&mut args, options);
    append_audio_encode_args(&mut args, options);

    let ext = Path::new(output)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "mp4" || ext == "mov" {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push("-max_muxing_queue_size".to_string());
    args.push("1024".to_string());
    args.push(output.to_string());

    args
}
