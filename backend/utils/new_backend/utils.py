from pathlib import Path
import subprocess
import av
import os
from constants import FRAME_BYTES
from concurrent.futures import ThreadPoolExecutor
import time

def resolve_paths(path_str):
    BASE_DIR = Path.cwd().resolve()

    return BASE_DIR + path_str

def check_if_path_exists(path_str):
    if not os.path.exists(path_str):
        return FileNotFoundError(f"Path does not exist: {path_str}")
    return True

def convert_scenes_to_timestamps(src_video, scenes):
    fps = probe_video_fps(src_video)
    cuts = scenes[:-1, 1]
    timestamps = cuts / fps
    return timestamps, cuts

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

def get_video_ranges(input_video):
    duration = probe_video_duration(input_video)

    first_quarter = (0, duration * 0.25)
    second_quarter = (duration * 0.25, duration * 0.50)
    third_quarter = (duration * 0.50, duration * 0.75)
    last_quarter = (duration * 0.75, duration)

    return (first_quarter, second_quarter, third_quarter, last_quarter)

def build_ffmpeg_cmd(input_video, start, end):
    return [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", str(input_video),
        "-pix_fmt", "rgb24",
        "-vf", "scale=48:27",
        "-f", "rawvideo",
        "pipe:1",
    ]

def read_process_frames(process_index, process):
    print(f"[Process {process_index}] Started reading")

    start_time = time.perf_counter()

    frames = []

    while True:
        raw_frame = process.stdout.read(FRAME_BYTES)

        if not raw_frame:
            break

        if len(raw_frame) != FRAME_BYTES:
            print(
                f"[Process {process_index}] Incomplete frame "
                f"({len(raw_frame)} bytes)"
            )
            break

        frames.append(raw_frame)

    process.wait()

    elapsed = time.perf_counter() - start_time

    print(
        f"[Process {process_index}] Finished "
        f"({len(frames)} frames, {elapsed:.2f}s)"
    )

    return frames


def spawn_parallel_processes(input_video):
    ranges = get_video_ranges(input_video)

    processes = []

    for i, (start, end) in enumerate(ranges):
        print(
            f"[Process {i}] Launching "
            f"({start:.2f}s -> {end:.2f}s)"
        )

        cmd = build_ffmpeg_cmd(input_video, start, end)

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

        processes.append((i, process))

    overall_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(
            executor.map(
                lambda p: read_process_frames(*p),
                processes,
            )
        )

    overall_elapsed = time.perf_counter() - overall_start

    print(
        f"\nAll processes finished in "
        f"{overall_elapsed:.2f}s"
    )

    return results