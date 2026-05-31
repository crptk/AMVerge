from transnetv2_pytorch import TransNetV2
import torch
import numpy as np
from utils import check_if_path_exists, convert_scenes_to_timestamps
import subprocess
from constants import FRAME_CHANNELS, FRAME_HEIGHT, FRAME_WIDTH
import sys
from tqdm import tqdm

device = "cuda" if torch.cuda.is_available() else "cpu"

def calculate_frame_bytes(width, height, channels):
    return width * height * channels

def decode_video(input_video):
    print(f"Calculating frame bytes..")
    frame_bytes = calculate_frame_bytes(FRAME_WIDTH, FRAME_HEIGHT, FRAME_CHANNELS)

    check_if_path_exists(input_video)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_video),
        "-pix_fmt", "rgb24",
        "-vf", "scale=48:27",
        "-f", "rawvideo",
        "pipe:1"
    ]

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, 
    )

    if process.stdout is None:
        raise RuntimeError("Failed to open FFmpeg stdout pipe")

    pbar = tqdm(
        desc = "Decoding video..",
        unit="frames",
        file=sys.stdout
    )

    frames: list[np.ndarray] = []

    while True:
        raw_frame = process.stdout.read(frame_bytes)

        if len(raw_frame) == 0:
            break
        
        if len(raw_frame) != frame_bytes:
            print(f"[ATTENTION] raw frame is not equal to frame bytes")

        frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape(
            FRAME_HEIGHT, FRAME_WIDTH, FRAME_CHANNELS
        )
        
        frames.append(frame)

        pbar.update(1)
    pbar.close()
    return np.stack(frames)

def run_model(frames, input_file, batch_size=100, overlap=50):
    num_frames = len(frames)

    scores = np.zeros(len(frames))
    counts = np.zeros(len(frames))

    stride = batch_size - overlap

    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    model = TransNetV2(device=device)
    model.eval()

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
    scenes = model.predictions_to_scenes(final_scores)
    
    second_timestamps, frame_timestamps = convert_scenes_to_timestamps(
        input_file, 
        scenes
    )
    progress.close()
    return second_timestamps, frame_timestamps

def main() -> int:
    try:
        print(f"Loading video...")
        input_file = sys.argv[1]
        output_dir = sys.argv[2]

        if check_if_path_exists(input_file):
            print(f"DECODING VIDEO...")
            frames = decode_video(input_file)

            # run the model on input_file to find places where it should be split
            sec_timestamps, frame_timestamps = run_model(frames, input_file)

            print(frame_timestamps)
        # TODO:cut the video on those parts, send it to output_dir
        
        return 0
    except Exception as error:
        import traceback

        print(f"ERROR: {error}")

        sys.stdout.flush()
        
        return 1

if __name__ == "__main__":
    raise SystemExit(main())