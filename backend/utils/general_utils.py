from pathlib import Path
import subprocess
import os
import numpy as np
from bisect import bisect_left
from tqdm import tqdm
import sys
import av
import threading
import hashlib

_progress_lock = threading.Lock()

def resolve_paths(path_str):
    BASE_DIR = Path.cwd().resolve()

    return BASE_DIR / path_str

def check_if_path_exists(path_str):
    if not os.path.exists(path_str):
        raise FileNotFoundError(f"Path does not exist: {path_str}")
    return True

def emit_progress(percent: int, message: str) -> None:
    """Emit progress to stderr.

    stdout is reserved for final JSON responses.
    Rust listens to stderr for PROGRESS lines.
    """

    clamped = max(0, min(100, int(percent)))

    with _progress_lock:
        print(f"PROGRESS|{clamped}|{message}", file=sys.stderr, flush=True)

def emit_event(line: str) -> None:
    """Emit a single machine-parsed event line (e.g. CLIP_READY|...) to stderr.

    Uses the same lock as emit_progress so event lines are never interleaved
    with progress lines, keeping each line intact for the Rust stderr parser.
    """
    with _progress_lock:
        print(line, file=sys.stderr, flush=True)

def log(message: str) -> None:
    text = str(message)

    try:
        print(text, file=sys.stderr, flush=True)
    except Exception:
        pass

def build_video_cache_prefix(input_video: Path) -> str:
    """Return a short stable prefix based on file path, size, and mtime.
    
    Used to namespace cached scene detection outputs per source video.
    """
    stat = input_video.stat()
    fingerprint = f"{input_video.resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    digest = hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()[:12]
    return f"scenes_{digest}"
