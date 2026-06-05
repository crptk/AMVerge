from transnetv2_pytorch import TransNetV2
import torch
import numpy as np
from utils import (
    check_if_path_exists, convert_scenes_to_timestamps, 
    probe_video_total_frames, scenes_frames_to_seconds, 
    probe_video_fps, probe_video_duration,
    get_keyframe_timestamps_pyav, 
    classify_scenes_by_keyframe_alignment,
    split_final_video
)
import subprocess
from constants import FRAME_CHANNELS, FRAME_HEIGHT, FRAME_WIDTH, WINDOW_SIZE, STRIDE, FRAME_BYTES
import sys
from tqdm import tqdm
from pathlib import Path
import os

device = "cuda" if torch.cuda.is_available() else "cpu"

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

def split_scenes_final_step(input_video, scenes_secs, output_dir):
    keyframes = get_keyframe_timestamps_pyav(input_video)

    keyframed_scenes_to_copy, scenes_to_reencode = classify_scenes_by_keyframe_alignment(scenes_secs=scenes_secs,
                                                                               keyframe_timestamps=keyframes,
                                                                               threshold=0.2)
    final_video_results = split_final_video(input_file=input_video,
                                            scenes_to_reencode=scenes_to_reencode,
                                            keyframed_scenes_to_copy=keyframed_scenes_to_copy,
                                            output_dir=output_dir
                                            )
    
def main() -> int:
    try:
        print(f"Loading video...")
        input_file = Path(sys.argv[1])
        output_dir = Path(sys.argv[2])

        print(f"input_file: {input_file}")

        print(f"DECODING VIDEO...")
        
        scenes_secs_paths = "franxx_scenes_secs.npy"
        scenes_frames_paths = "franxx_scenes_frames.npy"
        scenes_secs, scenes_frames = None, None
        
        if os.path.exists(scenes_secs_paths) and os.path.exists(scenes_frames_paths):
            print(f"Found cached model output scenes! Skipping model build..")
            scenes_secs = np.load(scenes_secs_paths)
            scenes_frames = np.load(scenes_frames_paths)
        else:
            scenes_secs, scenes_frames = decode_and_detect_scenes(input_file)
    
        split_scenes_final_step(input_video=input_file, scenes_secs=scenes_secs, output_dir=output_dir)
            # run the model on input_file to find places where it should be split
            # sec_timestamps, frame_timestamps = run_model(frames, input_file)
        # TODO:cut the video on those parts, send it to output_dir
        
        return 0
    except Exception as error:
        import traceback

        print(f"ERROR: {error}")

        sys.stdout.flush()
        
        return 1

if __name__ == "__main__":
    raise SystemExit(main())


# Feed it 100 frames incrementally as the decoding is happening

# So from decode_video, it finishes the first 100 frames, checks if the 100 frames is finished,
# if it is, send the 100 frames to run_model. Once that's finished, run_model will spit out the scene detection data and append
# it to scores and counts which is what would be passed into it. After in the decode_video loop, if the video is on frame 150,
# it'll send another request to trim 50:150 frames for processing. 

# How does the loop detection work?
# It first detects if the gap is 0-100. If the gap is 100 frames, it'll check if the...