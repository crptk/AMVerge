import sys
from pathlib import Path
from shutil import which


if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent.parent


def get_binary(name: str) -> str:
    """Return the path to a bundled binary like ffmpeg/ffprobe.

    Supports:
    - dev layout: backend/bin/ffmpeg.exe
    - older dev layout: backend/ffmpeg.exe
    - PyInstaller onedir: dist folder + _internal
    - PATH fallback
    """

    candidates = [
        # Most reliable for packaged sidecars.
        ROOT / "_internal" / name,
        ROOT / name,
        ROOT / "bin" / name,
    ]

    # Extra fallbacks when executable cwd differs from executable location.
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.extend([
            exe_dir / "_internal" / name,
            exe_dir / name,
            exe_dir / "bin" / name,
        ])

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    found = which(name)
    if found:
        found_path = Path(found)
        if found_path.is_absolute() and found_path.exists():
            return str(found_path)

    return str(candidates[0])
