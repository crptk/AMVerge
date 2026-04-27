import sys
import threading


_progress_lock = threading.Lock()


def emit_progress(percent: int, message: str) -> None:
    """Emit progress to stderr.

    stdout is reserved for final JSON responses.
    Rust listens to stderr for PROGRESS lines.
    """

    clamped = max(0, min(100, int(percent)))

    with _progress_lock:
        print(f"PROGRESS|{clamped}|{message}", file=sys.stderr, flush=True)