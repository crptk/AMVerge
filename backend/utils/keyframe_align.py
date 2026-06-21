from bisect import bisect_left
import av


def _nearest_within_threshold(sorted_keyframes, ts, threshold):
    """used to check if a detected scene is within a certain threshold of a keyframe (less)"""
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
        # Skip non-keyframe packets at the demux level. For indexed MKV files
        # this lets the demuxer use the cue index to jump between keyframes
        # instead of reading every packet sequentially.
        # (PyAV type stubs are missing this attribute; try/except handles older versions.)
        try:
            stream.discard = "NONKEY"  # type: ignore[attr-defined]
        except (AttributeError, KeyError):
            pass

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
    """Partition scenes into copy vs. reencode candidates.

    A scene is a *copy candidate* when its start timestamp lands within
    `threshold` seconds of a keyframe: that lets us stream-copy it losslessly
    (no decode, no quality loss) starting from that keyframe. A trailing
    non-keyframe end is fine for a copy — only the start must be a keyframe,
    matching `smart_cut.cut_scene`'s lossless-copy path. Scenes whose start is
    not near a keyframe are *reencode candidates* and need a smart cut.

    Returns (copy_candidates, reencode_candidates).
    """
    if threshold < 0:
        raise ValueError(f"Cannot have negative threshold ({threshold})")

    kf = sorted(float(x) for x in keyframe_timestamps)
    copy_candidates = []
    reencode_candidates = []
    for idx, scene in enumerate(scenes_secs):
        scene_start = float(scene[0])
        scene_end = float(scene[1])

        snapped_start, start_diff = _nearest_within_threshold(kf, scene_start, threshold)
        snapped_end, end_diff = _nearest_within_threshold(kf, scene_end, threshold)

        start_out = snapped_start if snapped_start is not None else scene_start
        end_out = snapped_end if snapped_end is not None else scene_end

        start_snapped = snapped_start is not None
        end_snapped = snapped_end is not None

        # Only the start needs to be on a keyframe to copy losslessly.
        mode = "copy_candidate" if start_snapped else "reencode_candidate"

        scene_record = {
            "scene_id": idx,
            "orig_start": scene_start,
            "orig_end": scene_end,
            "start": start_out,
            "end": end_out,
            "start_snapped": start_snapped,
            "end_snapped": end_snapped,
            "start_diff_sec": start_diff,
            "end_diff_sec": end_diff,
            "mode": mode,
        }

        if mode == "copy_candidate":
            copy_candidates.append(scene_record)
        else:
            reencode_candidates.append(scene_record)

    return copy_candidates, reencode_candidates
