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


def emit_event(event_type: str, payload: str = "") -> None:
    """Emit an arbitrary background event to stderr."""
    with _progress_lock:
        if payload:
            print(f"{event_type}|{payload}", file=sys.stderr, flush=True)
        else:
            print(event_type, file=sys.stderr, flush=True)