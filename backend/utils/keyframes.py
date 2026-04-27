import time

import av


def _clamp_int(value: int, lower: int, upper: int) -> int:
    return max(lower, min(upper, int(value)))


def _pts_to_seconds(pts, time_base) -> float | None:
    try:
        if pts is None or time_base is None:
            return None

        return float(pts * time_base)
    except Exception:
        return None


def _looks_pathological(times: list[float], duration_s: float | None) -> bool:
    """Detect bad keyframe lists that would create unusable tiny segments."""

    if len(times) < 2:
        return True

    times_sorted = sorted(times)

    # Non-increasing timestamps usually mean broken metadata.
    for previous, current in zip(times_sorted, times_sorted[1:]):
        if current <= previous:
            return True

    if duration_s and duration_s > 0:
        # More than 10 keyframes/sec is almost never useful for scene splitting.
        if (len(times_sorted) / duration_s) > 10.0:
            return True

    deltas = [
        current - previous
        for previous, current in zip(times_sorted, times_sorted[1:])
    ]
    deltas.sort()

    median = deltas[len(deltas) // 2]
    return median < 0.05


def _decode_keyframe_times(container, stream, emit_liveness) -> list[float]:
    """Fallback path. Decode only keyframes when packet flags are unreliable."""

    times: list[float] = []

    try:
        stream.codec_context.skip_frame = "NONKEY"
    except Exception:
        pass

    frame_index = 0

    for frame in container.decode(stream):
        frame_index += 1

        timestamp = _pts_to_seconds(frame.pts, stream.time_base)
        if timestamp is None:
            continue

        times.append(timestamp)

        if frame_index % 250 == 0:
            emit_liveness("decode", len(times), timestamp)

    return times


def generate_keyframes(
    video_path: str,
    progress_cb=None,
    *,
    progress_base: int = 10,
    progress_range: int = 30,
    progress_interval_s: float = 1.0,
) -> list[float]:
    """Generate keyframe timestamps in seconds.

    Uses packet metadata first because it is fast.
    Falls back to decode-based keyframes if packet metadata is missing or suspicious.
    """

    start_time = time.monotonic()
    last_emit_time = start_time - 9999.0

    def safe_progress(percent: int, message: str) -> None:
        if progress_cb is None:
            return

        try:
            progress_cb(int(percent), str(message))
        except Exception:
            # Progress reporting should never break video processing.
            pass

    def percent_for_time(timestamp_s: float | None, duration_s: float | None) -> int:
        base = int(progress_base)
        progress_span = max(0, int(progress_range))

        if duration_s is None or duration_s <= 0:
            return base

        if timestamp_s is None or timestamp_s < 0:
            return base

        fraction = max(0.0, min(1.0, timestamp_s / duration_s))
        return _clamp_int(base + int(progress_span * fraction), base, base + progress_span)

    def maybe_emit(stage: str, keyframes_found: int, timestamp_s: float | None, duration_s: float | None) -> None:
        nonlocal last_emit_time

        now = time.monotonic()
        if (now - last_emit_time) < float(progress_interval_s):
            return

        last_emit_time = now
        elapsed_s = now - start_time
        percent = percent_for_time(timestamp_s, duration_s)

        if duration_s and timestamp_s is not None and timestamp_s >= 0:
            message = (
                f"Extracting keyframes… stage={stage} found={keyframes_found} "
                f"at={timestamp_s:.1f}s/{duration_s:.1f}s elapsed={elapsed_s:.0f}s"
            )
        else:
            message = (
                f"Extracting keyframes… stage={stage} found={keyframes_found} "
                f"elapsed={elapsed_s:.0f}s"
            )

        safe_progress(percent, message)

    keyframes: list[float] = []

    with av.open(video_path) as container:
        stream = container.streams.video[0]

        duration_s: float | None = None
        try:
            if container.duration is not None:
                duration_s = float(container.duration) / 1_000_000.0
        except Exception:
            duration_s = None

        maybe_emit("open", 0, 0.0, duration_s)

        # Fast path: use packet keyframe flags.
        try:
            packet_index = 0
            last_timestamp_s: float | None = None

            for packet in container.demux(stream):
                packet_index += 1

                last_timestamp_s = _pts_to_seconds(packet.pts, stream.time_base)

                if packet.is_keyframe and last_timestamp_s is not None:
                    keyframes.append(last_timestamp_s)

                if packet_index % 500 == 0:
                    maybe_emit("demux", len(keyframes), last_timestamp_s, duration_s)

        except Exception:
            keyframes = []

        # Fallback path: packet flags can be missing or too dense on some files.
        if not keyframes or _looks_pathological(keyframes, duration_s):
            try:
                with av.open(video_path) as decode_container:
                    decode_stream = decode_container.streams.video[0]
                    maybe_emit("decode", 0, 0.0, duration_s)

                    keyframes = _decode_keyframe_times(
                        decode_container,
                        decode_stream,
                        lambda stage, count, ts: maybe_emit(stage, count, ts, duration_s),
                    )
            except Exception:
                return []

    # Normalize float noise and remove duplicates.
    normalized = sorted(
        set(round(t, 6) for t in keyframes if t is not None and t >= 0.0)
    )

    done_percent = int(progress_base) + max(0, int(progress_range))
    safe_progress(done_percent, f"Extracting keyframes… done found={len(normalized)}")

    return normalized