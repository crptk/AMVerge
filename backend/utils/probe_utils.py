import subprocess

def probe_video_fps(input_video):
    cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            input_video
        ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    fps_str = result.stdout.strip()
    num, den = map(int, fps_str.split("/"))
    fps = num / den

    return fps

def probe_video_dimensions(input_video):
    cmd_to_get_dims = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        str(input_video)
    ]
    result = subprocess.run(
        cmd_to_get_dims,
        capture_output=True,
        text=True,
        check=True
    )

    width, height = map(int, result.stdout.strip().split("x"))

    return width, height

def probe_video_duration(input_video):
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(input_video)
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=True
    )

    duration = float(result.stdout.strip())

    return duration

def probe_video_total_frames(input_video, video_fps, video_duration):
    total_frames = int(video_fps * video_duration)
    return total_frames
