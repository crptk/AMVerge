import os
from pathlib import Path
import sys

_NELUX_DLL_DIR_HANDLES = []
_NELUX_RUNTIME_CONFIGURED = False
_LAST_NELUX_CANDIDATE_DIRS = []
_REQUIRED_FFMPEG_DLLS = (
    "avcodec-62.dll",
    "avformat-62.dll",
    "avutil-60.dll",
    "swresample-6.dll",
    "swscale-9.dll",
)

def _directory_has_required_nelux_dlls(directory: Path) -> bool:
    return all((directory / dll_name).exists() for dll_name in _REQUIRED_FFMPEG_DLLS)

def _iter_common_windows_ffmpeg_dirs():
    common_roots = (
        Path("C:/ffmpeg-shared"),
        Path("C:/ffmpeg"),
        Path("C:/tools/ffmpeg"),
        Path("C:/Program Files/ffmpeg"),
        Path("C:/Program Files (x86)/ffmpeg"),
    )

    for root in common_roots:
        if not root.exists():
            continue
        yield root
        yield root / "bin"
        try:
            for child in root.iterdir():
                if child.is_dir():
                    yield child
                    yield child / "bin"
        except PermissionError:
            continue

def _iter_ffmpeg_dll_candidate_dirs():
    env_vars = ("AMVERGE_FFMPEG_BIN", "FFMPEG_BIN", "NELUX_FFMPEG_BIN")
    for env_var in env_vars:
        env_value = os.environ.get(env_var)
        if env_value:
            yield Path(env_value)

    script_dir = Path(__file__).resolve().parent
    search_roots = [
        Path.cwd(),
        script_dir,
        script_dir.parent,
        script_dir.parent.parent,
        script_dir.parent.parent.parent,
        Path(sys.executable).resolve().parent,
    ]

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        search_roots.append(Path(meipass))

    seen = set()
    suffixes = (
        Path("."),
        Path("bin"),
        Path("backend/bin"),
        Path("ffmpeg/bin"),
        Path("src-tauri/bin"),
    )

    for root in search_roots:
        for suffix in suffixes:
            candidate = (root / suffix).resolve()
            key = str(candidate).lower()
            if key in seen:
                continue
            seen.add(key)
            yield candidate

    if os.name == "nt":
        for candidate in _iter_common_windows_ffmpeg_dirs():
            key = str(candidate.resolve()).lower()
            if key in seen:
                continue
            seen.add(key)
            yield candidate.resolve()

def _configure_nelux_windows_runtime() -> None:
    """Register FFmpeg shared DLL directories so nelux can load them on Windows.
    
    No-op on non-Windows or after first successful call (idempotent).
    """
    global _NELUX_RUNTIME_CONFIGURED, _LAST_NELUX_CANDIDATE_DIRS
    if _NELUX_RUNTIME_CONFIGURED:
        return

    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        _NELUX_RUNTIME_CONFIGURED = True
        return

    selected_dirs = []
    candidate_dirs = []
    for candidate_dir in _iter_ffmpeg_dll_candidate_dirs():
        candidate_dirs.append(candidate_dir)
        if candidate_dir.is_dir() and _directory_has_required_nelux_dlls(candidate_dir):
            selected_dirs.append(candidate_dir)

    _LAST_NELUX_CANDIDATE_DIRS = candidate_dirs

    for directory in selected_dirs:
        handle = os.add_dll_directory(str(directory))
        _NELUX_DLL_DIR_HANDLES.append(handle)

    if selected_dirs:
        existing_path = os.environ.get("PATH", "")
        prepended = os.pathsep.join(str(path) for path in selected_dirs)
        os.environ["PATH"] = (
            f"{prepended}{os.pathsep}{existing_path}" if existing_path else prepended
        )

    _NELUX_RUNTIME_CONFIGURED = True

def _get_nelux_video_reader():
    _configure_nelux_windows_runtime()
    try:
        from nelux import VideoReader
    except ImportError as exc:
        searched_preview = ", ".join(str(path) for path in _LAST_NELUX_CANDIDATE_DIRS[:8])
        if not searched_preview:
            searched_preview = "<none>"
        raise ImportError(
            "Failed to import nelux. Configure FFmpeg shared DLL location via "
            "AMVERGE_FFMPEG_BIN (or FFMPEG_BIN) and ensure required DLLs are present. "
            f"Searched first paths: {searched_preview}"
        ) from exc

    return VideoReader

