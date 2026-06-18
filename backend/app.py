import torch
import numpy as np
from utils.utils import (
    log, emit_progress, check_if_path_exists,
    probe_video_duration, probe_video_fps,
    probe_video_dimensions
)
import sys
from pathlib import Path
import os
from utils.scene_detection_methods import decode_and_detect_scenes, decode_video_frames_nelux, run_model_one_pass
import json
import uuid
import hashlib


def _build_video_cache_prefix(input_video: Path) -> str:
    stat = input_video.stat()
    fingerprint = f"{input_video.resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    digest = hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()[:12]
    return f"scenes_{digest}"


def _scenes_to_objects(scenes_secs: np.ndarray, scenes_frames: np.ndarray) -> list[dict]:
    scenes: list[dict] = []

    total = min(len(scenes_secs), len(scenes_frames))
    for scene_index in range(total):
        sec_pair = scenes_secs[scene_index]
        frame_pair = scenes_frames[scene_index]

        start_sec = float(sec_pair[0])
        end_sec = float(sec_pair[1])
        start_frame = int(frame_pair[0])
        end_frame = int(frame_pair[1])

        scenes.append(
            {
                "scene_index": scene_index,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "duration_sec": max(0.0, end_sec - start_sec),
                "start_frame": start_frame,
                "end_frame": end_frame,
            }
        )

    return scenes
    
def main() -> int:
    try:
        if len(sys.argv) < 3:
            raise ValueError("Expected arguments: <input_video> <output_dir>")

        emit_progress(0, f"Loading video...")
        input_video = Path(sys.argv[1])
        output_dir = Path(sys.argv[2])
        check_if_path_exists(str(input_video))
        output_dir.mkdir(parents=True, exist_ok=True)

        device = "cuda" if torch.cuda.is_available() else "cpu"
        scenes_secs, scenes_frames = None, None

        cache_prefix = _build_video_cache_prefix(input_video)
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
            # METHOD 1:
            # scenes_secs, scenes_frames = decode_and_detect_scenes(input_video)

            # METHOD 2:
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
        scenes = _scenes_to_objects(scenes_secs=scenes_secs, scenes_frames=scenes_frames)

        emit_progress(95, "Finalizing scene manifest...")

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