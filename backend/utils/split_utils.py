from pathlib import Path
from tqdm import tqdm
import sys
import subprocess

def run_ffmpeg_checked(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print("FFMPEG CMD:", " ".join(map(str, cmd)))
        print("FFMPEG STDERR:\n", p.stderr)
        raise RuntimeError("ffmpeg failed")
    return p


def _split_keyframes(input_file, keyframed_scenes_to_copy, output_dir, manifest):
    total_keyframe_scenes = len(keyframed_scenes_to_copy)

    with tqdm(
        total=total_keyframe_scenes,
        desc="Splitting keyframed scenes quickly..",
        unit="scene",
        file=sys.stdout
    ) as pbar:
        for scene in keyframed_scenes_to_copy:
            scene_id = int(scene["scene_id"])
            start_sec = float(scene["start"])
            end_sec = float(scene["end"])

            if end_sec <= start_sec:
                print(f"Skipping scene {scene_id}: invalid range {start_sec} -> {end_sec}")
                pbar.update(1)
                continue

            out_path = output_dir / f"scene_{scene_id:04d}_copy.mp4"
            duration = end_sec - start_sec

            cmd_copy = [
                "ffmpeg",
                "-y",
                "-ss", str(start_sec),
                "-i", str(input_file),
                "-t", str(duration),
                "-map", "0:v:0",
                "-an",
                "-c:v", "copy",
                "-movflags", "+faststart",
                str(out_path),
            ]

            cmd_results = run_ffmpeg_checked(cmd_copy)
            manifest["copy_outputs"].append({
                "scene_id": scene_id,
                "path": str(out_path),
                "mode": "copy",
            })
            pbar.update(1)    

def _split_reencoded_scenes(input_file, scenes_to_reencode, output_dir, manifest, device="cpu"):
    total_reencode_scenes = len(scenes_to_reencode)

    if device == "cuda":
        print(f"Cuda detected! Decoding using cuda..")
    with tqdm(
        total=total_reencode_scenes,
        desc="Splitting scenes that need reencoding..",
        unit="scene",
        file=sys.stdout,
    ) as pbar:
        for scene in scenes_to_reencode:
            scene_id = int(scene["scene_id"])
            start_sec = float(scene["orig_start"])
            end_sec = float(scene["orig_end"])

            if end_sec <= start_sec:
                print(f"Skipping scene {scene_id}: invalid range {start_sec} -> {end_sec}")
                pbar.update(1)
                continue

            out_path = output_dir / f"scene_{scene_id:04d}_reencode.mp4"
            duration = end_sec - start_sec

            use_cuda = str(device).lower() == "cuda"

            if use_cuda:
                cmd_reencode = [
                    "ffmpeg",
                    "-y",
                    "-ss", str(start_sec),
                    "-i", str(input_file),
                    "-t", str(duration),
                    "-map", "0:v:0",
                    "-an",
                    "-c:v", "h264_nvenc",
                    "-preset", "p1",
                    "-rc", "vbr",
                    "-cq", "19",
                    "-b:v", "0",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            else:
                cmd_reencode = [
                    "ffmpeg",
                    "-y",
                    "-ss", str(start_sec),
                    "-i", str(input_file),
                    "-t", str(duration),
                    "-map", "0:v:0",
                    "-an",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "16",
                    "-pix_fmt", "yuv420p",
                    str(out_path),
                ]
            
            cmd_results = run_ffmpeg_checked(cmd_reencode)
            manifest["reencode_outputs"].append({
                "scene_id": scene_id,
                "path": str(out_path),
                "mode": "reencode",
            })
            pbar.update(1)

def split_final_video(input_file, scenes_to_reencode, keyframed_scenes_to_copy, output_dir, device="cpu"):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "copy_outputs": [],
        "reencode_outputs": [],
    }
    
    print("Splitting keyframe copy candidates...")

    _split_keyframes(input_file, keyframed_scenes_to_copy, output_dir, manifest)

    print("Splitting and re-encoding non-keyframe candidates...")

    _split_reencoded_scenes(input_file, scenes_to_reencode, output_dir, manifest, device=device)
    print("Done splitting scenes.")
    print(f"Copy scenes: {len(manifest['copy_outputs'])}")
    print(f"Re-encoded scenes: {len(manifest['reencode_outputs'])}")
    return manifest
