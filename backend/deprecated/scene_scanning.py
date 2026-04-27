import numpy as np
import subprocess
import math
import os
import cv2
import av
import sys
import json
from utils import generate_keyframes, keyframe_windows, merge_short_scenes, emit_progress
from concurrent.futures import ThreadPoolExecutor, as_completed

'''
This file contains the old scene detect algorithm I created, although it was accurate, it was too slow
so it's now deprecated. Now it only cuts at keyframes at main.py.
'''
#-----------------------------
#   SCENEDETECT ALGORITHM
#-----------------------------
def magnitude(vec):
    vec = math.sqrt(
        np.sum(vec**2) 
    )
    return vec

def pooling(frame, dim):
    arr = np.array(frame)

    # dividing then multiplying by dim to ensure it's divisible 
    h = (arr.shape[0] // dim) * dim
    w = (arr.shape[1] // dim) * dim
    arr = arr[:h, :w] # cropping so its perfectly divisible by dim

    # (# of blocks vertically, 'dim' rows per block, # of blocks horizontally, 'dim' rows per block)
    arr = arr.reshape(h // dim, dim, w // dim, dim)

    # print(f"Arr: {arr}")
    pooled = arr.mean(axis=(1, 3))

    return pooled

def cosine_similarity(frame1, frame2):
    a = np.array(frame1).flatten().astype(np.float32)
    b = np.array(frame2).flatten().astype(np.float32)
    
    numerator = np.dot(a, b)
    denominator = magnitude(a) * magnitude(b)

    cosine = numerator / denominator

    return cosine

def read_frames(
    video_path: str,
    start_sec: float,
    end_sec: float,
    threshold: float,
    blocksize: int = 3,
):
    """
    Runs cosine-based scene detection inside a specific time window
    using PyAV for decoding.

    Returns absolute timestamps (seconds).
    """

    container = av.open(video_path)
    stream = container.streams.video[0]

    # Seek to approximate position (PyAV seeks by microseconds)
    container.seek(int(start_sec * 1_000_000), any_frame=False, backward=True)

    prev = None
    cut_timestamps = []

    for frame in container.decode(stream):
        if frame.time is None:
            continue

        timestamp_sec = float(frame.time)

        # Skip frames before window (seek may land slightly earlier)
        if timestamp_sec < start_sec:
            continue

        # Stop once outside window
        if timestamp_sec > end_sec:
            break

        # Convert to grayscale numpy array
        frame = frame.reformat(width=480, height=270, format="gray")
        img = frame.to_ndarray()

        # Edge detection
        edges = cv2.Canny(img, 50, 100)

        if np.count_nonzero(edges) == 0:
            continue

        pooled = pooling(edges, blocksize)

        if prev is not None:
            dissimilarity = abs(1 - cosine_similarity(pooled, prev))

            if dissimilarity > threshold:
                cut_timestamps.append(timestamp_sec)

        prev = pooled

    container.close()
    return cut_timestamps

#-----------------------------
#     VIDEO PROCESSING
#-----------------------------

def detect_and_trim_scenes(
        original_video_path: str,
        threshold: float,
        radius: float = 0.6,
        output_dir: str = "./output_test",
        blocksize: int = 3
):
    os.makedirs(output_dir, exist_ok=True)

    emit_progress(10, "Capturing key areas..")
    keyframes = generate_keyframes(original_video_path)


    if not keyframes:
        return []
    windows = keyframe_windows(keyframes, radius)
    
    all_cut_timestamps = []
    total_windows = max(1, len(windows))
    emit_progress(30, "Scanning for scene cuts...")

    def scan_window(args):
        i, (start, end) = args
        return read_frames(original_video_path, start, end, threshold, blocksize)
    
    with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 4)) as executor:
        futures = {executor.submit(scan_window, (i, w)): i for i, w in enumerate(windows)}
        completed = 0
        for future in as_completed(futures):
            cuts = future.result()
            all_cut_timestamps.extend(cuts)
            completed += 1
            percent = 30 + int(40 * (completed / total_windows))
            emit_progress(percent, f"Scanning window {completed}/{total_windows}")

    all_cut_timestamps = sorted(set(all_cut_timestamps))

    emit_progress(70, "Finalizing scene boundaries")
    duration_cmd = [
        "ffprobe", "-i", original_video_path,
        "-show_entries", "format=duration",
        "-v", "quiet",
        "-of", "csv=p=0"
    ]
    result = subprocess.run(duration_cmd, stdout=subprocess.PIPE, text=True)
    duration = float(result.stdout.strip())

    scene_boundaries = sorted(set([0.0] + all_cut_timestamps + [duration]))
    scene_boundaries = merge_short_scenes(scene_boundaries, min_duration=0.5)

    emit_progress(80, "Cutting scenes..")
    cut_points = scene_boundaries[1:-1]
    out_pattern = os.path.join(output_dir, "scene_%04d.mp4")

    cmd = [
        "ffmpeg", "-y",
        "-i", original_video_path,
        "-c", "copy",
        "-f", "segment",
        "-segment_times", ",".join(f"{t:.6f}" for t in cut_points),
        "-reset_timestamps", "1",
        out_pattern
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    emit_progress(95, "Assembling results...")

    # Collect the output files ffmpeg created and match them to boundaries
    final_scenes = []
    for i in range(len(scene_boundaries) - 1):
        start = scene_boundaries[i]
        end = scene_boundaries[i + 1]
        out_path = os.path.join(output_dir, f"scene_{i:04d}.mp4")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            final_scenes.append({
                "scene_index": i,
                "start": start,
                "end": end,
                "path": out_path
            })

    emit_progress(100, "Done")
    return final_scenes
