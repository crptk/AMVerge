from pathlib import Path
import subprocess
import os

def resolve_paths(path_str):
    BASE_DIR = Path.cwd().resolve()

    return BASE_DIR + path_str

def check_if_path_exists(path_str):
    if not os.path.exists(path_str):
        return FileNotFoundError(f"Path does not exist: {path_str}")
    return True

def convert_scenes_to_timestamps(src_video, scenes):
    fps = get_fps(src_video)
    cuts = scenes[:-1, 1]
    timestamps = cuts / fps
    return timestamps, cuts

def get_fps(input_video):
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