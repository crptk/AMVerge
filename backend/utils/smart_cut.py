import os
import subprocess
from bisect import bisect_left, bisect_right
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from backend.utils.binaries import get_binary
from backend.utils.general_utils import emit_progress, log

KEYFRAME_SNAP_THRESHOLD = 0.2  # seconds - distance to a keyframe that counts as "on keyframe"
PRE_SEEK_OFFSET = 10.0         # seconds of fast-seek before the accurate post-input seek
HEVC_SNAP_MAX = 5.0            # for HEVC: max seconds we allow snapping start to a keyframe


def _background_subprocess_kwargs() -> dict:
    """Run cut ffmpeg below the UI's priority so background re-encodes don't
    starve the app's CPU/compositor (Windows). CREATE_NO_WINDOW also avoids
    transient console flashes. No-op on other platforms (preexec_fn is unsafe
    from the thread pool used for cutting)."""
    if os.name == "nt":
        return {
            "creationflags": subprocess.BELOW_NORMAL_PRIORITY_CLASS | subprocess.CREATE_NO_WINDOW
        }
    return {}


def _run_ffmpeg(cmd: list[str]) -> None:
    p = subprocess.run(
        cmd, capture_output=True, text=True, timeout=120, **_background_subprocess_kwargs()
    )
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {p.returncode}): {p.stderr[-600:]}")


def _lossless_copy(
    input_file: Path,
    start: float,
    end: float,
    out_path: Path,
    *,
    aac_audio: bool = False,
) -> None:
    """Copy video segment starting from a keyframe boundary — no decode, no quality loss.

    aac_audio=True re-encodes audio to AAC; use this for smart-cut tail segments so
    both head and tail share the same audio codec before concat.
    """
    ffmpeg = get_binary("ffmpeg")
    audio_args = ["-c:a", "aac", "-b:a", "128k"] if aac_audio else ["-c:a", "copy"]
    _run_ffmpeg([
        ffmpeg, "-y",
        "-ss", f"{start:.3f}",
        "-i", str(input_file),
        "-t", f"{end - start:.3f}",
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "copy",
        *audio_args,
        "-movflags", "+faststart",
        str(out_path),
    ])


def _encode_segment(input_file: Path, start: float, end: float, out_path: Path, use_cuda: bool) -> None:
    """Encode a segment with frame-accurate two-stage seeking."""
    ffmpeg = get_binary("ffmpeg")
    pre_seek = max(0.0, start - PRE_SEEK_OFFSET)
    post_seek = start - pre_seek
    duration = end - start

    if use_cuda:
        encode_args = ["-c:v", "h264_nvenc", "-preset", "p1", "-rc", "vbr", "-cq", "16", "-b:v", "0"]
    else:
        encode_args = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "16"]

    cmd = [ffmpeg, "-y"]
    if pre_seek > 0.0:
        cmd += ["-ss", f"{pre_seek:.3f}"]
    cmd += ["-i", str(input_file)]
    cmd += ["-ss", f"{post_seek:.3f}", "-t", f"{duration:.3f}"]
    cmd += ["-map", "0:v:0", "-map", "0:a?", "-pix_fmt", "yuv420p"]
    cmd += encode_args
    cmd += ["-c:a", "aac", "-b:a", "128k"]
    cmd += [str(out_path)]
    _run_ffmpeg(cmd)


def _concat_two(head_path: Path, tail_path: Path, out_path: Path, tmp_dir: Path, scene_idx: int) -> None:
    """Concatenate two segments using the ffmpeg concat demuxer (copy, no re-encode)."""
    ffmpeg = get_binary("ffmpeg")
    # Use scene_idx in filename so parallel cuts don't collide on this file.
    list_file = tmp_dir / f"_concat_{scene_idx:04d}.txt"
    list_file.write_text(
        f"file '{head_path.as_posix()}'\nfile '{tail_path.as_posix()}'\n",
        encoding="utf-8",
    )
    try:
        _run_ffmpeg([
            ffmpeg, "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            "-movflags", "+faststart",
            str(out_path),
        ])
    finally:
        list_file.unlink(missing_ok=True)


def _start_is_on_keyframe(start_sec: float, keyframes: list[float]) -> bool:
    i = bisect_left(keyframes, start_sec)
    for candidate_idx in (i - 1, i):
        if 0 <= candidate_idx < len(keyframes):
            if abs(keyframes[candidate_idx] - start_sec) <= KEYFRAME_SNAP_THRESHOLD:
                return True
    return False


def _find_next_keyframe_after(keyframes: list[float], after: float) -> float | None:
    """Return the first keyframe strictly after `after`, or None."""
    i = bisect_right(keyframes, after)
    return keyframes[i] if i < len(keyframes) else None


def cut_scene(
    input_file: Path,
    start_sec: float,
    end_sec: float,
    scene_idx: int,
    out_dir: Path,
    keyframes: list[float],
    use_cuda: bool,
    is_hevc: bool,
) -> tuple[str, str]:
    """
    Cut a single scene to out_dir/scene_NNNN.mp4.

    Returns (absolute_path, clip_mode) where clip_mode is one of:
      "copy"         — lossless stream copy (start was on a keyframe)
      "snapped_copy" — lossless stream copy snapped to nearest keyframe (HEVC only; start may be
                       up to HEVC_SNAP_MAX seconds off — acceptable for preview, export re-cuts precisely)
      "smartcut"     — encoded head + lossless tail concatenated (H.264 source only)
      "reencode"     — full segment re-encoded (fallback when no suitable keyframe found)
    """
    out_path = out_dir / f"scene_{scene_idx:04d}.mp4"
    duration = end_sec - start_sec

    if duration <= 0:
        raise ValueError(f"Non-positive duration for scene {scene_idx}: {duration:.3f}s")

    # Case 1: start is already on (or within threshold of) a keyframe — lossless copy.
    if _start_is_on_keyframe(start_sec, keyframes):
        _lossless_copy(input_file, start_sec, end_sec, out_path)
        return str(out_path), "copy"

    k_next = _find_next_keyframe_after(keyframes, start_sec)
    head_fraction = (k_next - start_sec) / duration if k_next is not None else 1.0

    # Case 2: HEVC source.
    # GPU (nvenc): fall through to full H.264 reencode — nvenc is fast enough (~1-2 min for a
    # full episode) and produces browser-compatible clips.
    # CPU only: H.264 reencode would take 10+ minutes. Instead snap the start to the nearest
    # keyframe (within HEVC_SNAP_MAX seconds) and lossless-copy. The clip may start a second
    # or two early/late, but this is a preview; export always re-cuts precisely from the original.
    if is_hevc and not use_cuda:
        i = bisect_right(keyframes, start_sec)
        snap_kf = None
        best_diff = float("inf")
        for ci in (i - 1, i):
            if 0 <= ci < len(keyframes):
                diff = abs(keyframes[ci] - start_sec)
                if diff < best_diff:
                    best_diff = diff
                    snap_kf = keyframes[ci]

        if snap_kf is not None and best_diff <= HEVC_SNAP_MAX and snap_kf < end_sec:
            _lossless_copy(input_file, snap_kf, end_sec, out_path)
            return str(out_path), "snapped_copy"
        # No keyframe within the snap window — fall through to reencode (slow but rare).

    # Case 3: H.264 — smart cut: encode the tiny non-keyframe head, lossless-copy the tail.
    # Both segments use AAC audio so the concat demuxer sees matching codecs.
    can_smartcut = (
        not is_hevc
        and k_next is not None
        and k_next < end_sec
        and head_fraction < 0.9  # don't smart cut if the tail would be pointless
    )

    if can_smartcut:
        head_path = out_dir / f"_head_{scene_idx:04d}.mp4"
        tail_path = out_dir / f"_tail_{scene_idx:04d}.mp4"
        try:
            _encode_segment(input_file, start_sec, k_next, head_path, use_cuda)
            _lossless_copy(input_file, k_next, end_sec, tail_path, aac_audio=True)
            _concat_two(head_path, tail_path, out_path, out_dir, scene_idx)
        finally:
            head_path.unlink(missing_ok=True)
            tail_path.unlink(missing_ok=True)
        return str(out_path), "smartcut"

    # Case 4: fallback full reencode (HEVC with no nearby keyframe, or very short H.264 scene).
    _encode_segment(input_file, start_sec, end_sec, out_path, use_cuda)
    return str(out_path), "reencode"


def cut_all_scenes(
    input_file: Path,
    scenes: list[dict],
    keyframes: list[float],
    out_dir: Path,
    use_cuda: bool,
    is_hevc: bool,
    max_workers: int = 4,
    on_ready=None,
    progress_range: tuple[int, int] = (82, 97),
    emit_progress_updates: bool = True,
) -> list[dict]:
    """
    Cut the given scenes in parallel. Returns a list of
    {scene_index, clip_path, clip_mode} dicts (completion order).

    `scenes` may be any subset of the detected scenes — results are keyed by the
    scene's own `scene_index`, not by list position, so subsets are safe.

    `on_ready(result)` is called on the calling thread as each scene finishes,
    which lets the caller stream each clip to the frontend immediately.
    `progress_range` is the (start%, end%) window to map cutting progress into.
    `emit_progress_updates=False` suppresses progress emission (used for the
    background re-encode phase, which runs after the loading screen has ended).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    total = len(scenes)
    results: list[dict] = []
    if total == 0:
        return results

    def _cut_one(scene: dict) -> dict:
        idx = scene["scene_index"]
        start_sec = float(scene["start_sec"])
        end_sec = float(scene["end_sec"])
        try:
            clip_path, clip_mode = cut_scene(
                input_file, start_sec, end_sec, idx, out_dir, keyframes, use_cuda, is_hevc,
            )
            log(f"Scene {idx}: {clip_mode} → {Path(clip_path).name}")
            return {"scene_index": idx, "clip_path": clip_path, "clip_mode": clip_mode}
        except Exception as exc:
            log(f"Warning: scene {idx} ({start_sec:.2f}–{end_sec:.2f}) failed: {exc}")
            return {"scene_index": idx, "clip_path": None, "clip_mode": "failed"}

    workers = min(max_workers, max(1, total))
    completed = 0
    p_start, p_end = progress_range
    p_span = max(0, p_end - p_start)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_cut_one, scene): scene for scene in scenes}
        for future in as_completed(futures):
            completed += 1
            if emit_progress_updates:
                pct = p_start + int((completed / total) * p_span)
                emit_progress(pct, f"Cutting scene {completed}/{total}...")
            result = future.result()
            results.append(result)
            if on_ready is not None:
                on_ready(result)

    return results
