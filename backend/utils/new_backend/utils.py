from pathlib import Path
import subprocess
import os
import numpy as np
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from bisect import bisect_left
from tqdm import tqdm
import sys
import av
import torch
def resolve_paths(path_str):
    BASE_DIR = Path.cwd().resolve()

    return BASE_DIR / path_str

def check_if_path_exists(path_str):
    if not os.path.exists(path_str):
        raise FileNotFoundError(f"Path does not exist: {path_str}")
    return True

def convert_scenes_to_timestamps(src_video, scenes):
    fps = probe_video_fps(src_video)
    cuts = scenes[:-1, 1]
    timestamps = cuts / fps
    return timestamps, cuts

def scenes_frames_to_seconds(scenes, fps):
    return np.round(scenes / fps, 2)

def probe_video_fps(input_video):
    cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            input_video
        ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    fps_str = result.stdout.strip()
    num, den = map(int, fps_str.split("/"))
    fps = num / den

    return fps

def probe_video_duration(input_video):
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input_video
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True
    )

    duration = float(result.stdout.strip())

    print(duration)
    return duration

def probe_video_total_frames(input_video, video_fps, video_duration):
    total_frames = int(video_fps * video_duration)
    return total_frames


def _nearest_within_threshold(sorted_keyframes, ts, threshold):
    i = bisect_left(sorted_keyframes, ts)
    candidates = []
    if i < len(sorted_keyframes):
        candidates.append(sorted_keyframes[i])
    if i > 0:
        candidates.append(sorted_keyframes[i - 1])
    if not candidates:
        return None, None

    nearest = min(candidates, key=lambda k: abs(k - ts))
    diff = abs(nearest - ts)
    if diff <= threshold:
        return nearest, diff
    return None, diff

def get_keyframe_timestamps_pyav(video_path: str):
    keyframe_times = []

    with av.open(video_path) as container:
        stream = container.streams.video[0]

        # Fast path: inspect packets instead of decoding every frame
        for packet in container.demux(stream):
            if not packet.is_keyframe:
                continue

            # Prefer PTS; fallback to DTS if needed
            ts = packet.pts if packet.pts is not None else packet.dts
            if ts is None:
                continue

            t = round(float(ts * packet.time_base), 2)
            keyframe_times.append(t)

    # Optional cleanup
    keyframe_times = sorted(set(keyframe_times))
    return keyframe_times

def classify_scenes_by_keyframe_alignment(scenes_secs, keyframe_timestamps, threshold=0.2):
    if threshold < 0:
        raise ValueError(f"Cannot have negative threshold ({threshold})")

    kf = sorted(float(x) for x in keyframe_timestamps)
    final_scene_cuts = []
    results_keyframes = []
    results_reencode = []
    for idx, scene in enumerate(scenes_secs):
        scene_start = float(scene[0])
        scene_end = float(scene[1])

        snapped_start, start_diff = _nearest_within_threshold(kf, scene_start, threshold)
        snapped_end, end_diff = _nearest_within_threshold(kf, scene_end, threshold)

        start_out = snapped_start if snapped_start is not None else scene_start
        end_out = snapped_end if snapped_end is not None else scene_end

        start_snapped = snapped_start is not None
        end_snapped = snapped_end is not None

        if start_snapped and end_snapped:
            mode = "copy_candidate"
        else:
            mode = "reencode_candidate"

        final_scene_cuts.append({
            "scene_id": idx,
            "orig_start": scene_start,
            "orig_end": scene_end,
            "start": start_out,
            "end": end_out,
            "start_snapped": start_snapped,
            "end_snapped": end_snapped,
            "start_diff_sec": start_diff,
            "end_diff_sec": end_diff,
            "mode": mode
        })

    for scene in final_scene_cuts:
        if scene["mode"] == "reencode_candidate":
            results_keyframes.append(scene)
        else:
            results_reencode.append(scene)

    return results_keyframes, results_reencode

def run_ffmpeg_checked(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print("FFMPEG CMD:", " ".join(map(str, cmd)))
        print("FFMPEG STDERR:\n", p.stderr)
        raise RuntimeError("ffmpeg failed")
    return p

def _split_keyframes(input_file, keyframed_scenes_to_copy, output_dir, manifest):
    total_keyframe_scenes = len(keyframed_scenes_to_copy)

    with tqdm(
        total=total_keyframe_scenes,
        desc="Splitting keyframed scenes quickly..",
        unit="scene",
        file=sys.stdout
    ) as pbar:
        for scene in keyframed_scenes_to_copy:
            scene_id = int(scene["scene_id"])
            start_sec = float(scene["start"])
            end_sec = float(scene["end"])

            if end_sec <= start_sec:
                print(f"Skipping scene {scene_id}: invalid range {start_sec} -> {end_sec}")
                pbar.update(1)
                continue

            out_path = output_dir / f"scene_{scene_id:04d}_copy.mp4"
            duration = end_sec - start_sec

            cmd_copy = [
                "ffmpeg",
                "-y",
                "-ss", str(start_sec),
                "-i", str(input_file),
                "-t", str(duration),
                "-map", "0:v:0",
                "-an",
                "-c:v", "copy",
                "-movflags", "+faststart",
                str(out_path),
            ]

            cmd_results = run_ffmpeg_checked(cmd_copy)
            manifest["copy_outputs"].append({
                "scene_id": scene_id,
                "path": str(out_path),
                "mode": "copy",
            })
            pbar.update(1)    

def _split_reencoded_scenes(input_file, scenes_to_reencode, output_dir, manifest, device="cpu"):
    total_reencode_scenes = len(scenes_to_reencode)

    if device == "cuda":
        print(f"Cuda detected! Decoding using cuda..")
    with tqdm(
        total=total_reencode_scenes,
        desc="Splitting scenes that need reencoding..",
        unit="scene",
        file=sys.stdout,
    ) as pbar:
        for scene in scenes_to_reencode:
            scene_id = int(scene["scene_id"])
            start_sec = float(scene["orig_start"])
            end_sec = float(scene["orig_end"])

            if end_sec <= start_sec:
                print(f"Skipping scene {scene_id}: invalid range {start_sec} -> {end_sec}")
                pbar.update(1)
                continue

            out_path = output_dir / f"scene_{scene_id:04d}_reencode.mp4"
            duration = end_sec - start_sec

            use_cuda = str(device).lower() == "cuda"

            if use_cuda:
                cmd_reencode = [
                    "ffmpeg",
                    "-y",
                    "-ss", str(start_sec),
                    "-i", str(input_file),
                    "-t", str(duration),
                    "-map", "0:v:0",
                    "-an",
                    "-c:v", "h264_nvenc",
                    "-preset", "p1",
                    "-rc", "vbr",
                    "-cq", "19",
                    "-b:v", "0",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            else:
                cmd_reencode = [
                    "ffmpeg",
                    "-y",
                    "-ss", str(start_sec),
                    "-i", str(input_file),
                    "-t", str(duration),
                    "-map", "0:v:0",
                    "-an",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "16",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            
            cmd_results = run_ffmpeg_checked(cmd_reencode)
            manifest["reencode_outputs"].append({
                "scene_id": scene_id,
                "path": str(out_path),
                "mode": "reencode",
            })
            pbar.update(1)


def split_final_video(input_file, scenes_to_reencode, keyframed_scenes_to_copy, output_dir, device="cpu"):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "copy_outputs": [],
        "reencode_outputs": [],
    }
    
    print("Splitting keyframe copy candidates...")

    _split_keyframes(input_file, keyframed_scenes_to_copy, output_dir, manifest)

    print("Splitting and re-encoding non-keyframe candidates...")

    _split_reencoded_scenes(input_file, scenes_to_reencode, output_dir, manifest, device=device)
    print("Done splitting scenes.")
    print(f"Copy scenes: {len(manifest['copy_outputs'])}")
    print(f"Re-encoded scenes: {len(manifest['reencode_outputs'])}")
    return manifest