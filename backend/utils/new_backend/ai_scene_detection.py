import torch
import numpy as np
from utils import (
    get_keyframe_timestamps_pyav, 
    classify_scenes_by_keyframe_alignment,
    split_final_video
)
import sys
from pathlib import Path
import os
from scene_detection_methods import decode_and_detect_scenes, decode_video_frames_nelux, run_model_one_pass

device = "cuda" if torch.cuda.is_available() else "cpu"

# method 1
def split_scenes_final_step(input_video, scenes_secs, output_dir):
    keyframes = get_keyframe_timestamps_pyav(input_video)

    keyframed_scenes_to_copy, scenes_to_reencode = classify_scenes_by_keyframe_alignment(scenes_secs=scenes_secs,
                                                                                        keyframe_timestamps=keyframes,
                                                                                        threshold=0.2)
    final_video_results = split_final_video(input_file=input_video,
                                            scenes_to_reencode=scenes_to_reencode,
                                            keyframed_scenes_to_copy=keyframed_scenes_to_copy,
                                            output_dir=output_dir,
                                            device=device
                                            )
    
def main() -> int:
    try:
        print(f"Loading video...")
        input_file = Path(sys.argv[1])
        output_dir = Path(sys.argv[2])

        print(f"input_file: {input_file}")

        print(f"DECODING VIDEO...")
        
        scenes_secs_paths = "franxx_scenes_secsaa.npy"
        scenes_frames_paths = "franxx_scenes_framesaa.npy"
        scenes_secs, scenes_frames = None, None
        
        if os.path.exists(scenes_secs_paths) and os.path.exists(scenes_frames_paths):
            print(f"Found cached model output scenes! Skipping model build..")
            scenes_secs = np.load(scenes_secs_paths)
            scenes_frames = np.load(scenes_frames_paths)
        else:
            ## METHOD 1:
            # scenes_secs, scenes_frames = decode_and_detect_scenes(input_file)
            
            ## METHOD 2:
            frames = decode_video_frames_nelux(input_file)
            scenes_secs, scenes_frames = run_model_one_pass(frames, input_file)
    
        print(f"result (manifest):\n {result}")
        # TODO:cut the video on those parts, send it to output_dir
        
        return 0
    except Exception as error:
        import traceback

        print(f"ERROR: {error}")

        sys.stdout.flush()
        
        return 1

if __name__ == "__main__":
    raise SystemExit(main())