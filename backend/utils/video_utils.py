import av
from .binaries import get_binary
from .keyframes import generate_keyframes
from .progress import emit_progress

def get_video_duration(video_path: str) -> float:
    with av.open(video_path) as container:
        return float(container.duration / av.time_base)



def merge_short_scenes(boundaries: list[float], min_duration: float = 0.5) -> list[float]:
    """Merge scene boundaries that would create tiny segments."""

    if len(boundaries) <= 2:
        return boundaries

    merged = [boundaries[0]]

    for timestamp in boundaries[1:]:
        if timestamp - merged[-1] < min_duration:
            # Skip this boundary so the tiny segment gets merged.
            continue

        merged.append(timestamp)

    return merged


__all__ = [
    "generate_keyframes",
    "emit_progress",
    "get_binary",
    "merge_short_scenes",
]