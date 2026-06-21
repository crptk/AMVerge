import os
import sys
from pathlib import Path
from shutil import which


if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent.parent


def _platform_names(name: str) -> list[str]:
    """Filenames to try for a bare binary name, platform-correct one first.

    Callers pass a bare name like "ffmpeg"; on Windows the runnable file is
    "ffmpeg.exe". The repo bundles an extension-less Linux/macOS "ffmpeg" next
    to "ffmpeg.exe" for cross-platform builds — that file *exists* on Windows
    but raises [WinError 193] when executed, so the ".exe" must take priority.
    """
    if os.name == "nt" and not name.lower().endswith(".exe"):
        return [f"{name}.exe", name]
    return [name]


def get_binary(name: str) -> str:
    """Return the path to a bundled binary like ffmpeg/ffprobe.

    Supports:
    - dev layout: backend/bin/ffmpeg.exe
    - older dev layout: backend/ffmpeg.exe
    - PyInstaller onedir: dist folder + _internal
    - PATH fallback
    """

    search_dirs = [
        # Most reliable for packaged sidecars.
        ROOT / "_internal",
        ROOT,
        ROOT / "bin",
    ]

    # Extra fallbacks when executable cwd differs from executable location.
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        search_dirs.extend([
            exe_dir / "_internal",
            exe_dir,
            exe_dir / "bin",
        ])

    names = _platform_names(name)

    # Within each directory, try the platform-correct filename first so an
    # extension-less wrong-platform binary never shadows the real executable.
    for directory in search_dirs:
        for candidate_name in names:
            candidate = directory / candidate_name
            if candidate.exists():
                return str(candidate)

    for candidate_name in names:
        found = which(candidate_name)
        if found:
            found_path = Path(found)
            if found_path.is_absolute() and found_path.exists():
                return str(found_path)

    return str(search_dirs[0] / names[0])
