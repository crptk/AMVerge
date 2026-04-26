import sys
import subprocess

def check_if_hevc(video):
    if not video or not str(video).strip():
        raise ValueError("No video path provided")

    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "default=nk=1:nw=1",
        video
    ]

    p = subprocess.run(cmd, capture_output=True, text=True)

    if p.returncode != 0:
        err = (p.stderr or "").strip()
        raise RuntimeError(
            f"ffprobe failed (exit {p.returncode})" + (f": {err}" if err else "")
        )
    
    codec = p.stdout.strip().lower()
    print(f"p = {codec}", file=sys.stderr)

    if codec == "hevc":
        return True
    return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("false")
        raise SystemExit(2)

    video = sys.argv[1]
    try:
        hevc_status = check_if_hevc(video)
    except Exception as e:
        print(f"hevc_check_error: {e}", file=sys.stderr)
        print("false")
        raise SystemExit(1)

    print("true" if hevc_status else "false")