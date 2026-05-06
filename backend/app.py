import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import av
from PIL import Image

from utils.video_utils import generate_keyframes, emit_progress, get_binary, merge_short_scenes, get_video_duration

# Running commands like ffmpeg can open a command window on Windows.
# This prevents that when the backend is launched from the app.
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# sys.frozen is an attribute added by PyInstaller when running as an executable.
IS_EXECUTABLE = getattr(sys, "frozen", False)

if IS_EXECUTABLE:
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(__file__)

_ff_ext = ".exe" if sys.platform == "win32" else ""
FFMPEG = get_binary(f"ffmpeg{_ff_ext}")

def run_stage(percent: int, message: str, fn):
    emit_progress(percent, message)

    try:
        return fn()
    except Exception as error:
        log(f"ERROR during '{message}': {error}")
        raise

def get_log_dir() -> str:
    # In installed builds, the sidecar exe often lives under a read-only
    # install/resources directory. Always log to a user-writable location.
    if sys.platform == "win32":
        base = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or tempfile.gettempdir()
        return os.path.join(base, "AMVerge")
    elif sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Logs", "AMVerge")
    else:
        xdg = os.getenv("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
        return os.path.join(xdg, "AMVerge")


def ensure_log_dir() -> str:
    log_dir = get_log_dir()

    try:
        os.makedirs(log_dir, exist_ok=True)
        return log_dir
    except Exception:
        # Last-ditch fallback.
        return tempfile.gettempdir()


DEBUG_LOG_DIR = ensure_log_dir()
DEBUG_LOG = os.path.join(DEBUG_LOG_DIR, "backend_debug.txt")


def log(message: str) -> None:
    text = str(message)

    try:
        print(text, file=sys.stderr, flush=True)
    except Exception:
        pass

    try:
        with open(DEBUG_LOG, "a", encoding="utf-8") as file:
            file.write(text + "\n")
    except Exception:
        pass


def format_timestamp(seconds: float) -> str:
    # Keep 6-decimal precision, but trim redundant trailing zeros.
    # This helps avoid Windows command-line length issues when passing
    # many cut points to ffmpeg through -segment_times.
    value = f"{float(seconds):.6f}"
    return value.rstrip("0").rstrip(".")


def make_thumbnail(clip_path: str, thumb_path: str) -> None:
    thumb_width = 360
    thumb_quality = 80

    try:
        with av.open(clip_path) as container:
            if not container.streams.video:
                log(f"Thumbnail skipped, no video stream: {clip_path}")
                return

            stream = container.streams.video[0]

            # Decode only keyframes, skip all others.
            stream.codec_context.skip_frame = "NONKEY"

            for frame in container.decode(stream):
                image = frame.to_image()

                new_width = thumb_width
                new_height = max(1, int(new_width * image.height / image.width))

                image = image.resize(
                    (new_width, new_height),
                    resample=Image.Resampling.BICUBIC,
                )

                image.save(thumb_path, "JPEG", quality=thumb_quality)
                return

            log(f"Thumbnail skipped, no decodable frame: {clip_path}")

    except Exception as error:
        log(f"Thumbnail failed for {clip_path}: {error}")


def generate_thumbnails(output_dir: str, scenes: list[dict[str, Any]], file_name: str) -> None:
    total = len(scenes)
    if total == 0:
        return

    # Avoid spamming progress messages for large imports.
    progress_step = max(1, total // 25)
    completed = 0

    def build_thumbnail(scene: dict[str, Any]) -> None:
        scene_index = scene["scene_index"]
        clip_path = os.path.join(output_dir, f"{file_name}_{scene_index:04d}.mp4")
        thumb_path = os.path.join(output_dir, f"{file_name}_{scene_index:04d}.jpg")

        if not os.path.exists(clip_path):
            log(f"Thumbnail skipped, clip missing: {clip_path}")
            return

        make_thumbnail(clip_path, thumb_path)

    emit_progress(90, f"Generating thumbnails... 0/{total}")

    max_workers = min(4, os.cpu_count() or 4)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(build_thumbnail, scene) for scene in scenes]

        for future in as_completed(futures):
            completed += 1

            try:
                future.result()
            except Exception as error:
                # build_thumbnail already handles most failures, but this keeps
                # unexpected thread errors from crashing the whole import.
                log(f"Thumbnail worker failed: {error}")

            if completed % progress_step == 0 or completed == total:
                emit_progress(90, f"Generating thumbnails... {completed}/{total}")


def run_ffmpeg_segment(video_path: str, output_pattern: str, cut_points: list[float]) -> None:
    cmd = [
        FFMPEG,
        "-y",
        "-i",
        video_path,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-map_metadata",
        "-1",
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_times",
        ",".join(format_timestamp(point) for point in cut_points),
        "-reset_timestamps",
        "1",
        output_pattern,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        creationflags=CREATE_NO_WINDOW,
    )

    log(result.stdout)
    log(result.stderr)

    if result.returncode != 0:
        # Keep the error readable. ffmpeg output can be extremely long.
        tail = result.stderr[-2000:] if result.stderr else "No stderr output."
        raise RuntimeError(f"ffmpeg failed with code {result.returncode}: {tail}")


def collect_scenes(
    output_dir: str,
    file_name: str,
    cut_points: list[float],
    total_duration: float,
) -> list[dict[str, Any]]:
    final_scenes: list[dict[str, Any]] = []
    boundaries = [0.0] + cut_points
    # Add the final duration as the last boundary
    all_boundaries = boundaries + [total_duration]

    for index in range(len(boundaries)):
        start = all_boundaries[index]
        end = all_boundaries[index + 1]

        out_path = os.path.join(output_dir, f"{file_name}_{index:04d}.mp4")
        thumb_path = os.path.join(output_dir, f"{file_name}_{index:04d}.jpg")

        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            final_scenes.append(
                {
                    "scene_index": index,
                    "start": start,
                    "end": end,
                    "path": out_path,
                    "thumbnail": thumb_path,
                    "original_file": file_name,
                }
            )

    return final_scenes


def trim_scenes_at_keyframes(video_path: str, output_dir: str) -> list[dict[str, Any]]:
    os.makedirs(output_dir, exist_ok=True)

    total_start = time.perf_counter()
    file_name = os.path.splitext(os.path.basename(video_path))[0]

    keyframes = run_stage(
        10,
        "Extracting keyframes...",
        lambda: generate_keyframes(
            video_path=video_path,
            progress_cb=emit_progress,
            progress_base=10,
            progress_range=30,
            progress_interval_s=1.0,
        )
    )

    log(f"Keyframes found: {len(keyframes)}")
    log(f"First few keyframes: {keyframes[:5]}")

    if not keyframes:
        log("No keyframes found. Returning empty scene list.")
        return []

    # Skip the first keyframe, usually 0.0.
    cut_points = sorted(keyframes[1:])

    # Guard against pathological keyframe lists creating tiny/1-frame segments.
    cut_points = merge_short_scenes([0.0] + cut_points, min_duration=0.25)[1:]

    output_pattern = os.path.join(output_dir, f"{file_name}_%04d.mp4")

    run_stage(
        50,
        f"Cutting {len(cut_points)} scenes...",
        lambda: run_ffmpeg_segment(video_path, output_pattern, cut_points)         
    )

    emit_progress(75, "Building scenes...")

    video_duration = run_stage(75, "Getting duration...", lambda: get_video_duration(video_path))

    final_scenes = run_stage(
        75,
        "Building scenes...",    
        lambda: collect_scenes(
        output_dir=output_dir,
        file_name=file_name,
        cut_points=cut_points,
        total_duration=video_duration)
    )

    run_stage(
        90,
        "Generating thumbnails...",
        lambda: generate_thumbnails(output_dir, final_scenes, file_name)
    )

    thumb_start = time.perf_counter()
    log(f"TIMING|thumbs_start|scenes={len(final_scenes)}")

    generate_thumbnails(output_dir, final_scenes, file_name)

    thumb_end = time.perf_counter()
    log(f"TIMING|thumbs_end|seconds={thumb_end - thumb_start:.3f}")

    emit_progress(100, "Done")

    total_end = time.perf_counter()
    log(f"TIMING|total_end_to_end|seconds={total_end - total_start:.3f}")

    return final_scenes


def main() -> int:
    try:
        input_file = sys.argv[1]
        output_dir = sys.argv[2]

        scenes = trim_scenes_at_keyframes(input_file, output_dir)

        # stdout is reserved for the final JSON response.
        # Rust reads this, then React parses it.
        print(json.dumps(scenes))
        sys.stdout.flush()

        return 0

    except Exception as error:
        import traceback

        log(f"FATAL ERROR: {error}")
        log(traceback.format_exc())

        # Always return valid JSON so Rust/React do not crash while parsing.
        print(json.dumps([]))
        print(f"debug_log_dir: {DEBUG_LOG_DIR}", file=sys.stderr)
        sys.stdout.flush()

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
