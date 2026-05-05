use std::process::Command;

use crate::utils::process::apply_no_window;

use super::types::NvidiaEncoderDetectionPayload;

fn infer_nvidia_profile_from_name(gpu_name: &str) -> String {
    let name = gpu_name.trim().to_ascii_lowercase();
    if !name.contains("nvidia") {
        return "unsupported".to_string();
    }
    if name.contains("rtx 50") || name.contains("blackwell") {
        return "blackwell".to_string();
    }
    if name.contains("rtx 40") || name.contains(" ada") {
        return "ada".to_string();
    }
    if name.contains("rtx 30")
        || name.contains("rtx 20")
        || name.contains("a10")
        || name.contains("a16")
        || name.contains("a2")
        || name.contains("ampere")
    {
        return "ampere".to_string();
    }
    if name.contains("gtx 16")
        || name.contains("titan rtx")
        || name.contains("quadro rtx")
        || name.contains("turing")
    {
        return "turing".to_string();
    }
    if name.contains("gtx 10")
        || name.contains("p40")
        || name.contains("p4")
        || name.contains("pascal")
    {
        return "pascal".to_string();
    }
    if name.contains("gtx 9") || name.contains("maxwell") {
        return "maxwell_2".to_string();
    }
    "unknown".to_string()
}

pub(super) async fn detect_nvidia_encoder_profile_inner(
) -> Result<NvidiaEncoderDetectionPayload, String> {
    let probe = tokio::task::spawn_blocking(|| {
        let mut cmd = Command::new("nvidia-smi");
        apply_no_window(&mut cmd);
        cmd.args(["--query-gpu=name", "--format=csv,noheader"])
            .output()
    })
    .await
    .map_err(|e| format!("nvidia-smi task panicked: {e}"))?;

    let output = match probe {
        Ok(output) => output,
        Err(_) => {
            return Ok(NvidiaEncoderDetectionPayload {
                has_nvidia_gpu: false,
                gpu_name: None,
                profile: "unsupported".to_string(),
            });
        }
    };

    if !output.status.success() {
        return Ok(NvidiaEncoderDetectionPayload {
            has_nvidia_gpu: false,
            gpu_name: None,
            profile: "unsupported".to_string(),
        });
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let gpu_name = raw
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.split(',').next().unwrap_or(line).trim().to_string());

    if let Some(name) = gpu_name {
        let profile = infer_nvidia_profile_from_name(&name);
        Ok(NvidiaEncoderDetectionPayload {
            has_nvidia_gpu: !matches!(profile.as_str(), "unsupported"),
            gpu_name: Some(name),
            profile,
        })
    } else {
        Ok(NvidiaEncoderDetectionPayload {
            has_nvidia_gpu: false,
            gpu_name: None,
            profile: "unsupported".to_string(),
        })
    }
}
