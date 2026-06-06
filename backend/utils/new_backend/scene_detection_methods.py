from transnetv2_pytorch import TransNetV2
import torch
import numpy as np
from utils import (
    check_if_path_exists, convert_scenes_to_timestamps, 
    probe_video_total_frames, scenes_frames_to_seconds, 
    probe_video_fps, probe_video_duration,
)
import subprocess
import os
from constants import FRAME_CHANNELS, FRAME_HEIGHT, FRAME_WIDTH, WINDOW_SIZE, STRIDE, FRAME_BYTES
import sys
from tqdm import tqdm
from pathlib import Path

_NELUX_DLL_DIR_HANDLES = []
_NELUX_RUNTIME_CONFIGURED = False
_LAST_NELUX_CANDIDATE_DIRS = []
_REQUIRED_FFMPEG_DLLS = (
    "avcodec-62.dll",
    "avformat-62.dll",
    "avutil-60.dll",
    "swresample-6.dll",
    "swscale-9.dll",
)

def _directory_has_required_nelux_dlls(directory: Path) -> bool:
    return all((directory / dll_name).exists() for dll_name in _REQUIRED_FFMPEG_DLLS)

def _iter_common_windows_ffmpeg_dirs():
    common_roots = (
        Path("C:/ffmpeg-shared"),
        Path("C:/ffmpeg"),
        Path("C:/tools/ffmpeg"),
        Path("C:/Program Files/ffmpeg"),
        Path("C:/Program Files (x86)/ffmpeg"),
    )

    for root in common_roots:
        if not root.exists():
            continue
        yield root
        yield root / "bin"
        try:
            for child in root.iterdir():
                if child.is_dir():
                    yield child
                    yield child / "bin"
        except PermissionError:
            continue

def _iter_ffmpeg_dll_candidate_dirs():
    env_vars = ("AMVERGE_FFMPEG_BIN", "FFMPEG_BIN", "NELUX_FFMPEG_BIN")
    for env_var in env_vars:
        env_value = os.environ.get(env_var)
        if env_value:
            yield Path(env_value)

    script_dir = Path(__file__).resolve().parent
    search_roots = [
        Path.cwd(),
        script_dir,
        script_dir.parent,
        script_dir.parent.parent,
        script_dir.parent.parent.parent,
        Path(sys.executable).resolve().parent,
    ]

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        search_roots.append(Path(meipass))

    seen = set()
    suffixes = (
        Path("."),
        Path("bin"),
        Path("backend/bin"),
        Path("ffmpeg/bin"),
        Path("src-tauri/bin"),
    )

    for root in search_roots:
        for suffix in suffixes:
            candidate = (root / suffix).resolve()
            key = str(candidate).lower()
            if key in seen:
                continue
            seen.add(key)
            yield candidate

    if os.name == "nt":
        for candidate in _iter_common_windows_ffmpeg_dirs():
            key = str(candidate.resolve()).lower()
            if key in seen:
                continue
            seen.add(key)
            yield candidate.resolve()

def _configure_nelux_windows_runtime() -> None:
    global _NELUX_RUNTIME_CONFIGURED, _LAST_NELUX_CANDIDATE_DIRS
    if _NELUX_RUNTIME_CONFIGURED:
        return

    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        _NELUX_RUNTIME_CONFIGURED = True
        return

    selected_dirs = []
    candidate_dirs = []
    for candidate_dir in _iter_ffmpeg_dll_candidate_dirs():
        candidate_dirs.append(candidate_dir)
        if candidate_dir.is_dir() and _directory_has_required_nelux_dlls(candidate_dir):
            selected_dirs.append(candidate_dir)

    _LAST_NELUX_CANDIDATE_DIRS = candidate_dirs

    for directory in selected_dirs:
        handle = os.add_dll_directory(str(directory))
        _NELUX_DLL_DIR_HANDLES.append(handle)

    if selected_dirs:
        existing_path = os.environ.get("PATH", "")
        prepended = os.pathsep.join(str(path) for path in selected_dirs)
        os.environ["PATH"] = (
            f"{prepended}{os.pathsep}{existing_path}" if existing_path else prepended
        )

    _NELUX_RUNTIME_CONFIGURED = True

def _get_nelux_video_reader():
    _configure_nelux_windows_runtime()
    try:
        from nelux import VideoReader
    except ImportError as exc:
        searched_preview = ", ".join(str(path) for path in _LAST_NELUX_CANDIDATE_DIRS[:8])
        if not searched_preview:
            searched_preview = "<none>"
        raise ImportError(
            "Failed to import nelux. Configure FFmpeg shared DLL location via "
            "AMVERGE_FFMPEG_BIN (or FFMPEG_BIN) and ensure required DLLs are present. "
            f"Searched first paths: {searched_preview}"
        ) from exc

    return VideoReader


## METHOD 1: Decode using FFMPEG and run GPU Scene Detection in parallel
def decode_and_detect_scenes(input_video):
    print(f"Calculating frame bytes..")

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
    
    print(f"Creating model..")
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
        file=sys.stdout,
        total=total_frames
    ) # progressbar obj

    while True:
        raw_frame = process.stdout.read(FRAME_BYTES)

        if len(raw_frame) == 0:
            break
        
        if len(raw_frame) != FRAME_BYTES:
            print(f"[ATTENTION] raw frame is not equal to frame bytes")

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

        pbar.update(1)
    pbar.close()

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
    print(f"Running decode video nelux function..")
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
    with tqdm(
        desc="Decoding video with nelux..",
        unit="frames",
        file=sys.stdout,
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
            pbar.update(1)

    if actual_frames < total_frames:
        frames = frames[:actual_frames]

    return frames

def run_model_one_pass(frames, input_file, batch_size=100, overlap=50):
    print(f"Running model one pass.")
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
        unit="frames"
    )

    for start in range(0, len(frames), stride):
        end = min(start + batch_size, num_frames)
        frames_batch = frames[start : end].copy()

        tensor = torch.from_numpy(frames_batch).unsqueeze(dim=0).to(device)

        single_frame_pred, _ = model(tensor)
        preds = single_frame_pred.detach().cpu().numpy().squeeze()

        scores[start : end] += preds
        counts[start : end] += 1
        progress.update(stride)

    final_scores = scores / counts
    scenes_frames = model.predictions_to_scenes(final_scores)

    progress.close()

    scenes_secs = scenes_frames_to_seconds(scenes_frames, video_fps)
    return scenes_secs, scenes_frames