import numpy as np
from backend.utils.probe_utils import probe_video_fps

def convert_scenes_to_timestamps(src_video, scenes):
    fps = probe_video_fps(src_video)
    cuts = scenes[:-1, 1]
    timestamps = cuts / fps
    return timestamps, cuts

def scenes_frames_to_seconds(scenes, fps):
    return np.round(scenes / fps, 2)


def scenes_to_objects(scenes_secs: np.ndarray, scenes_frames: np.ndarray) -> list[dict]:
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