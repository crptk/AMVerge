import subprocess
import os
import sys
import json
import tempfile
from utils.video_utils import generate_keyframes, emit_progress, get_binary, merge_short_scenes
from concurrent.futures import ThreadPoolExecutor, as_completed
import av
from PIL import Image
import time 

# running cmds like ffmpeg opens command window, this prevents that
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

is_executable = getattr(sys, "frozen", False)

# sys.frozen is an attribute added to executables, so this checks if it's an executable running
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(__file__)

def _log_dir() -> str:
    # In installed builds, the sidecar exe often lives under a read-only
    # install/resources directory. Always log to a user-writable location.
    base = (
        os.getenv("LOCALAPPDATA")
        or os.getenv("APPDATA")
        or tempfile.gettempdir()
    )
    return os.path.join(base, "AMVerge")

DEBUG_LOG_DIR = _log_dir()
try:
    os.makedirs(DEBUG_LOG_DIR, exist_ok=True)
except Exception:
    # Last-ditch fallback
    DEBUG_LOG_DIR = tempfile.gettempdir()

DEBUG_LOG = os.path.join(DEBUG_LOG_DIR, "backend_debug.txt")

def log(msg):
    try:
        with open(DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        # Never crash the backend due to logging.
        pass

FFMPEG = get_binary("ffmpeg.exe")
FFPROBE = get_binary("ffprobe.exe")

def generate_thumbnails(output_dir: str, scenes: list, file_name: str):
    total = len(scenes)
    if total == 0:
        return
    step = max(1, total // 25)  # ~25 updates max
    done = 0

    def make_thumb(scene):
        i = scene["scene_index"]
        clip_path = os.path.join(output_dir, f"{file_name}_{i:04d}.mp4")
        thumb_path = os.path.join(output_dir, f"{file_name}_{i:04d}.jpg")
        
        try:
            with av.open(clip_path) as container:
                stream = container.streams.video[0]
                stream.codec_context.skip_frame = "NONKEY"
                for frame in container.decode(stream):
                    img = frame.to_image()

                    THUMB_WIDTH = 360
                    THUMB_QUALITY = 80

                    new_w = THUMB_WIDTH
                    new_h = max(1, int(new_w * img.height / img.width))

                    img = img.resize((new_w, new_h), resample=Image.Resampling.BICUBIC)
                    img.save(thumb_path, "JPEG", quality=THUMB_QUALITY)
                    break  # only need first frame
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 4)) as executor:
        futures = [executor.submit(make_thumb, scene) for scene in scenes]
        emit_progress(90, f"Generating thumbnails... 0/{total}")
        for _ in as_completed(futures):
            done += 1
            if done % step == 0 or done == total:
                emit_progress(90, f"Generating thumbnails... {done}/{total}")

def trim_scenes_at_keyframes(video_path: str, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    t_total0 = time.perf_counter()

    file_name = os.path.splitext(os.path.basename(video_path))[0]

    emit_progress(10, "Extracting keyframes...")

    def _kf_progress(percent: int, message: str) -> None:
        emit_progress(percent, message)

    keyframes = generate_keyframes(
        video_path=video_path,
        progress_cb=_kf_progress,
        progress_base=10,
        progress_range=30,
        progress_interval_s=1.0,
    )
    print(f"Keyframes found: {len(keyframes)}", file=sys.stderr, flush=True)
    print(f"First few: {keyframes[:5]}", file=sys.stderr, flush=True)
    
    if not keyframes:
        print("No keyframes found, returning empty", file=sys.stderr, flush=True)
        return []

    def _fmt_ts(t: float) -> str:
        # Keep the existing 6-decimal precision, but trim redundant trailing zeros
        # to avoid Windows command-line length issues (WinError 206) when passing
        # thousands of cut points to ffmpeg via `-segment_times`.
        s = f"{float(t):.6f}"
        s = s.rstrip("0").rstrip(".")
        return s
    
    # Skip the first keyframe(0.0)
    cut_points = sorted(keyframes[1:])
    # Guard against pathological keyframe lists creating tiny/1-frame segments.
    cut_points = merge_short_scenes([0.0] + cut_points, min_duration=0.25)[1:]
    emit_progress(50, f"Cutting {len(cut_points)} scenes...")

    out_pattern = os.path.join(output_dir, f"{file_name}_%04d.mp4")

    cmd = [
        FFMPEG, "-y",
        "-i", video_path,
        "-c", "copy",
        "-f", "segment",
        "-segment_times", ",".join(_fmt_ts(t) for t in cut_points),
        "-reset_timestamps", "1",
        out_pattern
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
    log(result.stdout)
    log(result.stderr)

    print(f"Output dir: {output_dir}", file=sys.stderr)
    # print(f"Files created: {os.listdir(output_dir)}", file=sys.stderr, flush=True)

    # Collect results
    emit_progress(75, "Building scenes..")

    final_scenes = []
    boundaries = [0.0] + cut_points
    for i, start in enumerate(boundaries):
        end = boundaries[i + 1] if i + 1 < len(boundaries) else None
        out_path = os.path.join(output_dir, f"{file_name}_{i:04d}.mp4")
        thumb_path = os.path.join(output_dir, f"{file_name}_{i:04d}.jpg")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            final_scenes.append({
                "scene_index": i,
                "start": start,
                "end": end,
                "path": out_path,
                "thumbnail": thumb_path,
                "original_file": file_name
            })

    emit_progress(90, "Generating thumbnails...")
    
    t_thumbs0 = time.perf_counter()
    print(f"TIMING|thumbs_start|scenes={len(final_scenes)}", file=sys.stderr, flush=True)

    generate_thumbnails(output_dir, final_scenes, file_name)

    t_thumbs1 = time.perf_counter()
    print(f"TIMING|thumbs_end|seconds={t_thumbs1 - t_thumbs0:.3f}", file=sys.stderr, flush=True)

    emit_progress(100, "Done")

    t_total1 = time.perf_counter()
    print(f"TIMING|total_end_to_end|seconds={t_total1 - t_total0:.3f}", file=sys.stderr, flush=True)

    return final_scenes

if __name__ == "__main__":
    try:
        input_file = sys.argv[1]
        output_dir = sys.argv[2]

        scenes = trim_scenes_at_keyframes(input_file, output_dir)
        print("About to print JSON", file=sys.stderr, flush=True)
        print(json.dumps(scenes)) # sends to stdout for rust to collect, react parses it
        if sys.stdout:
            sys.stdout.flush()
    except Exception as e:
        import traceback
        log(f"FATAL ERROR: {e}")
        log(traceback.format_exc())
        print(json.dumps([]))
        print(f"debug_log_dir: {DEBUG_LOG_DIR}", file=sys.stderr)
        sys.stdout.flush()
        sys.exit(1)