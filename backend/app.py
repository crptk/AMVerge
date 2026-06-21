import sys
from pathlib import Path

# When Python runs this as a script (python app.py), sys.path[0] is backend/ not
# the workspace root, so 'from backend.utils.xxx' imports fail. Insert workspace root first.
_WS_ROOT = str(Path(__file__).resolve().parent.parent)
if _WS_ROOT not in sys.path:
    sys.path.insert(0, _WS_ROOT)

import torch
import numpy as np
from backend.utils.scene_detection_methods import (decode_video_frames_nelux, run_model_one_pass)
from backend.utils.general_utils import (log, emit_progress, check_if_path_exists, build_video_cache_prefix)
from backend.utils.probe_utils import (probe_video_duration, probe_video_fps, probe_video_dimensions)
from backend.utils.scene_utils import scenes_to_objects
import sys
from pathlib import Path
import json
import uuid

def main() -> int:
    try:
        if len(sys.argv) < 3:
            raise ValueError("Expected arguments: <input_video> <output_dir>")

        emit_progress(0, f"Loading video...")
        input_video = Path(sys.argv[1])
        output_dir = Path(sys.argv[2])
        import_method = sys.argv[4] if len(sys.argv) > 4 else "video_files"
        
        check_if_path_exists(str(input_video))
        output_dir.mkdir(parents=True, exist_ok=True)

        device = "cuda" if torch.cuda.is_available() else "cpu"
        scenes_secs, scenes_frames = None, None

        cache_prefix = build_video_cache_prefix(input_video)
        scenes_secs_path = output_dir / f"{cache_prefix}_secs.npy"
        scenes_frames_path = output_dir / f"{cache_prefix}_frames.npy"
        cache_hit = False
        
        emit_progress(5, "Preparing scene detection cache...")

        if scenes_secs_path.exists() and scenes_frames_path.exists():
            cache_hit = True
            scenes_secs = np.load(scenes_secs_path)
            scenes_frames = np.load(scenes_frames_path)
            emit_progress(20, "Loaded cached scene detection results.")
        else:
            emit_progress(20, "Decoding frames for TransNetV2...")
            frames = decode_video_frames_nelux(input_video)

            emit_progress(55, "Running TransNetV2 scene detection...")
            scenes_secs, scenes_frames = run_model_one_pass(frames, input_video)
            
            np.save(scenes_secs_path, scenes_secs)
            np.save(scenes_frames_path, scenes_frames)

            emit_progress(80, "Saved scene detection cache.")
    
        input_video_duration = probe_video_duration(input_video)
        input_video_fps = probe_video_fps(input_video)
        input_video_width, input_video_height = probe_video_dimensions(input_video)
        scenes = scenes_to_objects(scenes_secs=scenes_secs, scenes_frames=scenes_frames)

        if import_method == "video_files":
            from backend.utils.keyframe_align import (
                get_keyframe_timestamps_pyav,
                classify_scenes_by_keyframe_alignment,
            )
            from backend.utils.codec_utils import check_if_hevc
            from backend.utils.smart_cut import cut_all_scenes
            from backend.utils.general_utils import emit_event

            # Emit the full scene list right away so the grid renders before any
            # cutting happens; each tile fills in as its clip becomes ready.
            source_name = input_video.name
            source_str = str(input_video)
            initial_clips = [
                {
                    "scene_index": s["scene_index"],
                    "start_sec": s["start_sec"],
                    "end_sec": s["end_sec"],
                    "path": source_str,
                    "thumbnail": source_str,
                    "original_file": source_name,
                    "original_path": source_str,
                    "clip_path": None,
                    "clip_mode": None,
                }
                for s in scenes
            ]
            emit_event(f"INITIAL_CLIPS_READY|{json.dumps(initial_clips)}")

            emit_progress(82, "Extracting keyframe timestamps...")
            keyframes = get_keyframe_timestamps_pyav(str(input_video))
            is_hevc = check_if_hevc(str(input_video))

            # Split scenes: those whose start is on a keyframe can be lossless-copied
            # immediately (fast); the rest need a smart re-encode and run afterwards.
            scene_pairs = [(s["start_sec"], s["end_sec"]) for s in scenes]
            copy_candidates, reencode_candidates = classify_scenes_by_keyframe_alignment(
                scene_pairs, keyframes
            )
            copy_idx = {c["scene_id"] for c in copy_candidates}
            phase1_scenes = [s for s in scenes if s["scene_index"] in copy_idx]
            phase2_scenes = [s for s in scenes if s["scene_index"] not in copy_idx]
            log(
                f"Video cut split: {len(phase1_scenes)} lossless copies, "
                f"{len(phase2_scenes)} re-encodes"
            )

            scenes_out_dir = output_dir / "scenes"
            cut_by_idx: dict[int, dict] = {}

            def _on_clip_ready(result: dict) -> None:
                cut_by_idx[result["scene_index"]] = result
                clip_path = result.get("clip_path") or ""
                clip_mode = result.get("clip_mode") or "failed"
                emit_event(f"CLIP_READY|{result['scene_index']}|{clip_path}|{clip_mode}")

            # Phase 1: fast lossless copies, streamed to the UI as they finish.
            # Copies are cheap (no decode), so run them wide for quick first paint.
            cut_all_scenes(
                input_file=input_video,
                scenes=phase1_scenes,
                keyframes=keyframes,
                out_dir=scenes_out_dir,
                use_cuda=(device == "cuda"),
                is_hevc=is_hevc,
                max_workers=8,
                on_ready=_on_clip_ready,
                progress_range=(82, 99),
            )

            # Keyframe clips are all on disk and streamed to the grid: tell the
            # frontend phase 1 is done so it can drop the loading screen. Phase 2
            # re-encodes then run in this same process (no second torch startup)
            # and keep streaming CLIP_READY in the background.
            emit_progress(100, "Keyframe clips ready")
            emit_event("PHASE1_COMPLETE")

            # Phase 2: re-encodes in the background, streamed as they finish.
            # Encodes are CPU/GPU bound, so keep the pool narrower to avoid thrash.
            # The loading screen has already finished, so these stream silently
            # (no main progress); instead we emit REENCODE_PROGRESS so the UI can
            # show a "Reencoding X/Y" count in the background progress bar.
            phase2_total = len(phase2_scenes)
            phase2_done = 0
            if phase2_total:
                emit_event(f"REENCODE_PROGRESS|0|{phase2_total}")

            def _on_reencode_ready(result: dict) -> None:
                nonlocal phase2_done
                _on_clip_ready(result)
                phase2_done += 1
                emit_event(f"REENCODE_PROGRESS|{phase2_done}|{phase2_total}")

            # Keep phase-2 narrow: these run in the background while the user is
            # already interacting with the grid, so a wide pool of nvenc/x264
            # encodes starves the UI (GPU compositor + CPU decode contention).
            # 2 keeps the machine responsive at a modest cost to total encode time.
            cut_all_scenes(
                input_file=input_video,
                scenes=phase2_scenes,
                keyframes=keyframes,
                out_dir=scenes_out_dir,
                use_cuda=(device == "cuda"),
                is_hevc=is_hevc,
                max_workers=2,
                on_ready=_on_reencode_ready,
                emit_progress_updates=False,
            )

            for scene in scenes:
                cut = cut_by_idx.get(scene["scene_index"], {})
                scene["clip_path"] = cut.get("clip_path")
                scene["clip_mode"] = cut.get("clip_mode", "failed")

        emit_progress(97, "Finalizing scene manifest...")

        result = {
            "schema_version": "1.0",
            "run_id": str(uuid.uuid4()),
            "video": {
                "video_file_path": str(input_video),
                "duration_sec": input_video_duration,
                "width": input_video_width,
                "height": input_video_height,
                "fps": input_video_fps,
            },
            "cache": {
                "cache_hit": cache_hit,
                "secs_path": str(scenes_secs_path),
                "frames_path": str(scenes_frames_path),
            },
            "scenes": scenes,
            "scenes_secs": scenes_secs.tolist(),
            "scenes_frames": scenes_frames.tolist(),
            "detector": {
                "method": "run_model_one_pass",
                "device": device,
            },
            "warnings": [],
            "error": None,
        }
        print(json.dumps(result))
        sys.stdout.flush()
        
        return 0
    
    except Exception as error:
        import traceback

        log(f"FATAL ERROR: {error}")
        log(traceback.format_exc())

        print(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "run_id": str(uuid.uuid4()),
                    "video": None,
                    "cache": None,
                    "scenes": [],
                    "scenes_secs": [],
                    "scenes_frames": [],
                    "detector": {
                        "method": "run_model_one_pass",
                        "device": "cuda" if torch.cuda.is_available() else "cpu",
                    },
                    "warnings": [],
                    "error": {
                        "message": str(error),
                        "type": type(error).__name__,
                    },
                }
            )
        )
        sys.stdout.flush()
        
        return 1

if __name__ == "__main__":
    raise SystemExit(main())