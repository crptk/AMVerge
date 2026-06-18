from transnetv2_pytorch import TransNetV2
import torch
import numpy as np
from utils.utils import (
    check_if_path_exists, convert_scenes_to_timestamps, 
    probe_video_total_frames, scenes_frames_to_seconds, 
    probe_video_fps, probe_video_duration, emit_progress, log
)
from utils.initialize_nelux import _get_nelux_video_reader
import subprocess
from utils.constants import FRAME_CHANNELS, FRAME_HEIGHT, FRAME_WIDTH, WINDOW_SIZE, STRIDE, FRAME_BYTES
import sys
from tqdm import tqdm


def _safe_total_frames(total_frames):
    return max(1, int(total_frames) if total_frames else 0)


def _emit_loop_progress(
    processed_frames,
    total_frames,
    base_percent,
    span_percent,
    message_prefix,
    last_emitted_percent,
):
    """Emit progress only used for loops"""
    safe_total = _safe_total_frames(total_frames)
    fraction = min(1.0, max(0.0, processed_frames / safe_total))
    current_percent = int(base_percent + (fraction * span_percent))

    if current_percent > last_emitted_percent:
        emit_progress(
            current_percent,
            f"{message_prefix} ({processed_frames}/{safe_total} frames)",
        )
        return current_percent

    return last_emitted_percent


## METHOD 1: Decode using FFMPEG and run GPU Scene Detection in parallel
def decode_and_detect_scenes(input_video):
    emit_progress(10, f"Calculating frame bytes..")

    check_if_path_exists(input_video)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_video),
        "-pix_fmt", "rgb24",
        "-vf", "scale=48:27",
        "-f", "rawvideo",
        "pipe:1"
    ]
    video_fps = probe_video_fps(input_video)
    video_duration = probe_video_duration(input_video)
    total_frames = probe_video_total_frames(input_video, video_fps, video_duration)
    
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if process.stdout is None:
        raise RuntimeError("Failed to create stdout pipe")
    
    emit_progress(20, "Creating model..")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = TransNetV2(device=device)
    model.eval()

    window_start_index = 0
    buffer = []
    scores = []
    counts = []

    pbar = tqdm(
        desc = "Decoding video..",
        unit="frames",
        file=sys.stderr,
        total=total_frames
    ) # progressbar obj

    processed_frames = 0
    last_decode_progress = 19

    while True:
        raw_frame = process.stdout.read(FRAME_BYTES)

        if len(raw_frame) == 0:
            break
        
        if len(raw_frame) != FRAME_BYTES:
            log(f"[ATTENTION] raw frame is not equal to frame bytes")

        # converting the raw bytes frame to (r, g, b) values each
        frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape(
            FRAME_HEIGHT, FRAME_WIDTH, FRAME_CHANNELS
        )
        buffer.append(frame)
        scores.append(0.0)
        counts.append(0)

        # this is where the gpu runs on the batch
        if len(buffer) >= WINDOW_SIZE:
            batch = np.stack(buffer[:WINDOW_SIZE])
            _run_model(model=model,
                      batch=batch,
                      start_index=window_start_index,
                      scores=scores,
                      counts=counts,
                      device=device
            )
            buffer = buffer[STRIDE:]
            window_start_index += STRIDE

        processed_frames += 1

        if processed_frames % 10 == 0:
            last_decode_progress = _emit_loop_progress(
                processed_frames=processed_frames,
                total_frames=total_frames,
                base_percent=20,
                span_percent=30,
                message_prefix="Decoding video...",
                last_emitted_percent=last_decode_progress,
            )
    #     pbar.update(1)
    # pbar.close()

    if len(buffer) > 0:
        batch = np.stack(buffer)

        _run_model(
            model=model,
            batch=batch,
            start_index=window_start_index,
            scores=scores,
            counts=counts,
            device=device,
        )

    # Ensure decode phase reaches its terminal milestone.
    emit_progress(50, f"Decoding video... ({processed_frames}/{_safe_total_frames(total_frames)})")

    scores = np.array(scores)
    counts = np.array(counts)
    
    final_scores = scores / counts
    scenes_frames = model.predictions_to_scenes(final_scores)

    second_timestamps, frame_timestamps = convert_scenes_to_timestamps(
        input_video, 
        scenes_frames
    )
    scenes_secs = scenes_frames_to_seconds(scenes_frames, video_fps)

    np.save("franxx_scenes_secs.npy", scenes_secs)
    np.save("franxx_scenes_frames.npy", scenes_frames)

    return scenes_secs, scenes_frames

def _run_model(model, batch, start_index, scores, counts, device):    
    tensor = torch.from_numpy(batch).unsqueeze(dim=0).to(device)

    with torch.inference_mode():
        single_frame_pred, _ = model(tensor)
    
    preds = single_frame_pred.detach().cpu().numpy().squeeze()

    end = len(batch)

    for i, pred in enumerate(preds):
        global_index = start_index + i
        scores[global_index] += pred
        counts[global_index] += 1

## METHOD 2: Decode using Nelux and run GPU Scene Detection after
def decode_video_frames_nelux(input_video):
    """Decode frames with nelux into the same shape consumed by TransNetV2.

    Returns a numpy array with shape:
    (num_frames, FRAME_HEIGHT, FRAME_WIDTH, FRAME_CHANNELS), dtype=uint8
    """
    log("Running decode video nelux function..")
    check_if_path_exists(input_video)

    VideoReader = _get_nelux_video_reader()
    decode_accelerator = "nvdec" if torch.cuda.is_available() else None
    reader = VideoReader(
        str(input_video),
        decode_accelerator=decode_accelerator,
        resize=(FRAME_WIDTH, FRAME_HEIGHT),
    )

    total_frames = len(reader)
    frames = np.empty(
        (total_frames, FRAME_HEIGHT, FRAME_WIDTH, FRAME_CHANNELS),
        dtype=np.uint8,
    )

    actual_frames = 0
    last_decode_progress = 19
    with tqdm(
        desc="Decoding video with nelux..",
        unit="frames",
        file=sys.stderr,
        total=total_frames,
    ) as pbar:
        for i in range(total_frames):
            frame = reader.read_frame()
            if frame is None:
                break

            if isinstance(frame, torch.Tensor):
                frame_np = frame.detach().to("cpu").numpy().astype(np.uint8, copy=False)
            else:
                frame_np = np.asarray(frame, dtype=np.uint8)

            # Normalize to HWC layout expected by TransNetV2 input preprocessing.
            if frame_np.ndim != 3:
                raise ValueError(f"Unexpected frame rank from nelux: {frame_np.ndim}")

            if frame_np.shape[0] == FRAME_CHANNELS and frame_np.shape[-1] != FRAME_CHANNELS:
                frame_np = np.transpose(frame_np, (1, 2, 0))

            if frame_np.shape != (FRAME_HEIGHT, FRAME_WIDTH, FRAME_CHANNELS):
                raise ValueError(
                    "Unexpected frame shape from nelux. "
                    f"Got {frame_np.shape}, expected "
                    f"({FRAME_HEIGHT}, {FRAME_WIDTH}, {FRAME_CHANNELS})."
                )

            frames[i] = frame_np
            actual_frames += 1
            if actual_frames % 10 == 0:
                last_decode_progress = _emit_loop_progress(
                    processed_frames=actual_frames,
                    total_frames=total_frames,
                    base_percent=20,
                    span_percent=35,
                    message_prefix="Decoding video...",
                    last_emitted_percent=last_decode_progress,
                )
            # pbar.update(1)
    # pbar.close()
    if actual_frames < total_frames:
        frames = frames[:actual_frames]

    emit_progress(55, f"Decoding video... ({actual_frames}/{_safe_total_frames(total_frames)})")

    return frames

def run_model_one_pass(frames, input_file, batch_size=100, overlap=50):
    log("Running model one pass.")
    num_frames = len(frames)

    scores = np.zeros(len(frames))
    counts = np.zeros(len(frames))

    stride = batch_size - overlap

    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    model = TransNetV2(device=device)
    model.eval()
    video_fps = probe_video_fps(input_file)

    progress = tqdm(
        total = len(frames),
        desc="Scene Detection",
        unit="frames",
        file=sys.stderr,
    )

    last_model_progress = 54

    for start in range(0, len(frames), stride):
        end = min(start + batch_size, num_frames)
        frames_batch = frames[start : end].copy()

        tensor = torch.from_numpy(frames_batch).unsqueeze(dim=0).to(device)

        single_frame_pred, _ = model(tensor)
        preds = single_frame_pred.detach().cpu().numpy().squeeze()

        scores[start : end] += preds
        counts[start : end] += 1

        last_model_progress = _emit_loop_progress(
            processed_frames=end,
            total_frames=num_frames,
            base_percent=55,
            span_percent=20,
            message_prefix="Running TransNetV2 scene detection...",
            last_emitted_percent=last_model_progress,
        )
        # progress.update(stride)

    final_scores = scores / counts
    scenes_frames = model.predictions_to_scenes(final_scores)

    emit_progress(75, f"Running TransNetV2 scene detection... ({num_frames}/{_safe_total_frames(num_frames)})")

    progress.close()

    scenes_secs = scenes_frames_to_seconds(scenes_frames, video_fps)
    return scenes_secs, scenes_frames