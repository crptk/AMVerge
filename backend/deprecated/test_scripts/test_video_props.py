import argparse
import json
import os
import platform
import sys
import traceback
from typing import Any

try:
    import av  # PyAV
except Exception as e:  # pragma: no cover
    print("Failed to import PyAV (av):", e, file=sys.stderr)
    raise

try:
    from PIL import ImageStat  # type: ignore
except Exception:
    ImageStat = None  # type: ignore


def _safe_int(x: Any) -> int | None:
    try:
        return int(x)
    except Exception:
        return None


def _safe_float(x: Any) -> float | None:
    try:
        return float(x)
    except Exception:
        return None


def _frac_to_str(x: Any) -> str | None:
    # PyAV uses fractions for time_base, sample_aspect_ratio, etc.
    try:
        if x is None:
            return None
        num = getattr(x, "numerator", None)
        den = getattr(x, "denominator", None)
        if num is not None and den is not None:
            return f"{num}/{den}"
        return str(x)
    except Exception:
        return None


def _rational_seconds(pts: Any, time_base: Any) -> float | None:
    try:
        if pts is None or time_base is None:
            return None
        return float(pts * time_base)
    except Exception:
        return None


def _stream_dict(stream: Any) -> dict[str, Any]:
    def safe_get(label: str, fn):
        try:
            return fn(), None
        except Exception as e:
            return None, f"{label}: {type(e).__name__}({e})"

    cc = getattr(stream, "codec_context", None)

    errs: list[str] = []

    st_type, err = safe_get("type", lambda: getattr(stream, "type", None))
    if err:
        errs.append(err)
    st_index, err = safe_get("index", lambda: getattr(stream, "index", None))
    if err:
        errs.append(err)
    st_id, err = safe_get("id", lambda: getattr(stream, "id", None))
    if err:
        errs.append(err)
    st_meta, err = safe_get("metadata", lambda: dict(getattr(stream, "metadata", {}) or {}))
    if err:
        errs.append(err)
        st_meta = {}

    st_time_base, err = safe_get("time_base", lambda: getattr(stream, "time_base", None))
    if err:
        errs.append(err)
    st_avg_rate, err = safe_get("average_rate", lambda: getattr(stream, "average_rate", None))
    if err:
        errs.append(err)
    st_base_rate, err = safe_get("base_rate", lambda: getattr(stream, "base_rate", None))
    if err:
        errs.append(err)
    st_duration, err = safe_get("duration", lambda: getattr(stream, "duration", None))
    if err:
        errs.append(err)
    st_start_time, err = safe_get("start_time", lambda: getattr(stream, "start_time", None))
    if err:
        errs.append(err)
    st_frames, err = safe_get("frames", lambda: getattr(stream, "frames", None))
    if err:
        errs.append(err)
    st_disp, err = safe_get("disposition", lambda: str(getattr(stream, "disposition", "")))
    if err:
        errs.append(err)

    d: dict[str, Any] = {
        "type": st_type,
        "index": st_index,
        "id": st_id,
        "language": (st_meta or {}).get("language"),
        "time_base": _frac_to_str(st_time_base),
        "avg_rate": _frac_to_str(st_avg_rate),
        "base_rate": _frac_to_str(st_base_rate),
        "duration": _safe_int(st_duration),
        "duration_seconds": _rational_seconds(st_duration, st_time_base),
        "start_time": _safe_int(st_start_time),
        "start_time_seconds": _rational_seconds(st_start_time, st_time_base),
        "frames": _safe_int(st_frames),
        "metadata": st_meta,
        "disposition": st_disp,
        "_errors": errs,
    }

    if cc is not None:
        cc_errs: list[str] = []

        cc_name, err = safe_get("cc.name", lambda: getattr(cc, "name", None))
        if err:
            cc_errs.append(err)
        cc_codec, err = safe_get("cc.codec.name", lambda: getattr(getattr(cc, "codec", None), "name", None))
        if err:
            cc_errs.append(err)
        cc_profile, err = safe_get("cc.profile", lambda: getattr(cc, "profile", None))
        if err:
            cc_errs.append(err)
        cc_level, err = safe_get("cc.level", lambda: getattr(cc, "level", None))
        if err:
            cc_errs.append(err)
        cc_pix_fmt, err = safe_get("cc.pix_fmt", lambda: getattr(cc, "pix_fmt", None))
        if err:
            cc_errs.append(err)
        cc_fmt, err = safe_get("cc.format.name", lambda: getattr(getattr(cc, "format", None), "name", None))
        if err:
            cc_errs.append(err)
        cc_width, err = safe_get("cc.width", lambda: getattr(cc, "width", None))
        if err:
            cc_errs.append(err)
        cc_height, err = safe_get("cc.height", lambda: getattr(cc, "height", None))
        if err:
            cc_errs.append(err)
        cc_cw, err = safe_get("cc.coded_width", lambda: getattr(cc, "coded_width", None))
        if err:
            cc_errs.append(err)
        cc_ch, err = safe_get("cc.coded_height", lambda: getattr(cc, "coded_height", None))
        if err:
            cc_errs.append(err)
        cc_br, err = safe_get("cc.bit_rate", lambda: getattr(cc, "bit_rate", None))
        if err:
            cc_errs.append(err)
        cc_fps, err = safe_get("cc.framerate", lambda: getattr(cc, "framerate", None))
        if err:
            cc_errs.append(err)
        # NOTE: cc.time_base may throw "Cannot access 'time_base' as a decoder" in PyAV.
        cc_tb, err = safe_get("cc.time_base", lambda: getattr(cc, "time_base", None))
        if err:
            cc_errs.append(err)
        cc_tpf, err = safe_get("cc.ticks_per_frame", lambda: getattr(cc, "ticks_per_frame", None))
        if err:
            cc_errs.append(err)
        cc_extrasize, err = safe_get(
            "cc.extradata_size",
            lambda: len(getattr(cc, "extradata", b"")) if getattr(cc, "extradata", None) is not None else None,
        )
        if err:
            cc_errs.append(err)

        d["codec"] = {
            "name": cc_name,
            "codec": cc_codec,
            "profile": cc_profile,
            "level": cc_level,
            "pix_fmt": cc_pix_fmt,
            "format": cc_fmt,
            "width": _safe_int(cc_width),
            "height": _safe_int(cc_height),
            "coded_width": _safe_int(cc_cw),
            "coded_height": _safe_int(cc_ch),
            "bit_rate": _safe_int(cc_br),
            "framerate": _frac_to_str(cc_fps),
            "time_base": _frac_to_str(cc_tb),
            "ticks_per_frame": _safe_int(cc_tpf),
            "extradata_size": _safe_int(cc_extrasize),
            "_errors": cc_errs,
        }

        # Audio-only fields (safe to query even if video)
        d["codec"].update(
            {
                "sample_rate": _safe_int(getattr(cc, "sample_rate", None)),
                "channels": _safe_int(getattr(cc, "channels", None)),
                "channel_layout": getattr(cc, "channel_layout", None),
                "sample_fmt": getattr(getattr(cc, "format", None), "name", None),
            }
        )

    # Video stream convenience
    if st_type == "video":
        d.update(
            {
                "width": _safe_int(getattr(stream, "width", None)),
                "height": _safe_int(getattr(stream, "height", None)),
                "sar": _frac_to_str(getattr(stream, "sample_aspect_ratio", None)),
                "dar": _frac_to_str(getattr(stream, "display_aspect_ratio", None)),
            }
        )

    return d


def _frame_brightness_hint(frame: Any) -> dict[str, Any]:
    """Compute a tiny brightness hint; helps spot 'black frame' symptoms.

    Uses PIL if available. This is best-effort and never fails the run.
    """
    out: dict[str, Any] = {}
    try:
        img = frame.to_image()
        out["mode"] = getattr(img, "mode", None)
        out["size"] = list(getattr(img, "size", ()))
        if ImageStat is None:
            return out

        stat = ImageStat.Stat(img)
        out["mean"] = stat.mean
        out["extrema"] = stat.extrema
        # Heuristic: mean of all channels near 0.
        try:
            means = stat.mean
            out["looks_black"] = all(m is not None and m < 2 for m in means)
        except Exception:
            pass
    except Exception:
        return out
    return out


def probe(path: str, tolerant: bool, max_decode_frames: int) -> dict[str, Any]:
    lib_versions = getattr(av, "library_versions", None)
    if callable(lib_versions):
        try:
            lib_versions_value = lib_versions()
        except Exception:
            lib_versions_value = None
    else:
        lib_versions_value = lib_versions

    report: dict[str, Any] = {
        "input": {
            "path": path,
            "exists": os.path.exists(path),
            "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
        },
        "env": {
            "python": sys.version,
            "platform": platform.platform(),
            "av_version": getattr(av, "__version__", None),
            "av_library_versions": lib_versions_value,
        },
        "open": {"tolerant": tolerant, "options": {}},
        "container": {},
        "streams": [],
        "decode_test": {},
        "errors": [],
    }

    options: dict[str, str] = {}
    if tolerant:
        # Only for debugging; helps with files that need deeper probing.
        options = {
            "probesize": str(64 * 1024 * 1024),
            "analyzeduration": str(20 * 1000 * 1000),
        }
        report["open"]["options"] = dict(options)

    try:
        container = av.open(path, options=options if options else None)
    except Exception as e:
        report["errors"].append({"stage": "av.open", "error": repr(e)})
        report["errors"].append({"stage": "av.open", "traceback": traceback.format_exc()})
        return report

    with container:
        fmt = getattr(container, "format", None)
        report["container"] = {
            "format": getattr(fmt, "name", None),
            "format_long": getattr(fmt, "long_name", None),
            "duration": _safe_int(getattr(container, "duration", None)),
            "duration_seconds": _safe_float(getattr(container, "duration", 0) / 1_000_000) if getattr(container, "duration", None) is not None else None,
            "bit_rate": _safe_int(getattr(container, "bit_rate", None)),
            "start_time": _safe_int(getattr(container, "start_time", None)),
            "metadata": dict(getattr(container, "metadata", {}) or {}),
        }

        streams_out: list[dict[str, Any]] = []
        for idx, s in enumerate(container.streams):
            try:
                streams_out.append(_stream_dict(s))
            except Exception as e:
                streams_out.append(
                    {
                        "index": idx,
                        "_errors": [f"stream_dict: {type(e).__name__}({e})"],
                        "_traceback": traceback.format_exc(),
                    }
                )
        report["streams"] = streams_out

        # Decode test (bounded)
        try:
            video_stream = next((s for s in container.streams if s.type == "video"), None)
            if video_stream is None:
                report["decode_test"] = {"ok": False, "reason": "no video stream"}
            else:
                # First try: keyframes only (matches your app's intent)
                decoded = 0
                keyframes = 0
                first_pts = None
                first_time = None
                brightness = None

                try:
                    video_stream.codec_context.skip_frame = "NONKEY"
                except Exception:
                    pass

                for frame in container.decode(video_stream):
                    decoded += 1
                    if getattr(frame, "key_frame", False):
                        keyframes += 1
                    if decoded == 1:
                        first_pts = frame.pts
                        first_time = _rational_seconds(frame.pts, video_stream.time_base)
                        brightness = _frame_brightness_hint(frame)
                    if decoded >= max_decode_frames:
                        break

                report["decode_test"] = {
                    "ok": decoded > 0,
                    "decoded_frames": decoded,
                    "decoded_keyframes": keyframes,
                    "skip_frame": "NONKEY",
                    "first_frame_pts": first_pts,
                    "first_frame_time_seconds": first_time,
                    "first_frame_brightness": brightness,
                }

                # If nothing decoded, run a second decode attempt without skipping.
                if decoded == 0:
                    try:
                        container2 = av.open(path, options=options if options else None)
                    except Exception as e:
                        report["decode_test"]["fallback_open_error"] = repr(e)
                    else:
                        with container2:
                            vs2 = next((s for s in container2.streams if s.type == "video"), None)
                            if vs2 is not None:
                                try:
                                    vs2.codec_context.skip_frame = "DEFAULT"
                                except Exception:
                                    pass

                                decoded2 = 0
                                first_pts2 = None
                                first_time2 = None
                                brightness2 = None
                                for frame in container2.decode(vs2):
                                    decoded2 += 1
                                    if decoded2 == 1:
                                        first_pts2 = frame.pts
                                        first_time2 = _rational_seconds(frame.pts, vs2.time_base)
                                        brightness2 = _frame_brightness_hint(frame)
                                    if decoded2 >= max_decode_frames:
                                        break

                                report["decode_test"]["fallback"] = {
                                    "ok": decoded2 > 0,
                                    "decoded_frames": decoded2,
                                    "skip_frame": "DEFAULT",
                                    "first_frame_pts": first_pts2,
                                    "first_frame_time_seconds": first_time2,
                                    "first_frame_brightness": brightness2,
                                }
        except Exception as e:
            report["errors"].append({"stage": "decode_test", "error": repr(e)})
            report["errors"].append({"stage": "decode_test", "traceback": traceback.format_exc()})

    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dump video/container/codec properties via PyAV for debugging."
    )
    parser.add_argument("path", help="Path to the video file (quote it on Windows)")
    parser.add_argument(
        "--tolerant",
        action="store_true",
        help="Use larger probe/analyze values when opening (slower, but more info)",
    )
    parser.add_argument(
        "--max-decode-frames",
        type=int,
        default=3,
        help="How many frames to attempt decoding in the bounded test (default: 3)",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON (easier to read)",
    )

    args = parser.parse_args()

    report = probe(args.path, tolerant=args.tolerant, max_decode_frames=args.max_decode_frames)
    if args.pretty:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(report, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
