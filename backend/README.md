# backend

Welcome to the AMVerge backend.

This folder contains the Python side of the app. It handles the video processing work that would be too heavy or awkward to run in the frontend.

The frontend is React.  
Tauri (Rust) connects the desktop app to native commands.  
This backend does the media work.

---

# What This Backend Handles

Main responsibilities:

- read video metadata
- detect keyframes
- split videos into clips
- generate thumbnails
- export selected clips
- merge clips during export
- help with codec support (HEVC / H.265)

Most import and export actions eventually call something in this folder.

---

# High Level Flow

```txt
Frontend (React)
   ↓
Tauri Command (Rust)
   ↓
Python Backend
   ↓
FFmpeg / FFprobe / PyAV
````

Example:

1. User imports a video
2. Frontend calls a Tauri command
3. Rust launches Python
4. Python creates clips + thumbnails
5. JSON is returned to the frontend

---

# Why Python

Python is a practical choice here.

Benefits:

* easy to control FFmpeg
* strong video libraries
* fast to build features with
* easy to package as a sidecar executable

This backend is focused on getting results, not being fancy.

---

# Folder Structure

```
backend/
├── app.py
├── requirements.txt
├── backend_script.spec
│
├── bin/
│   ├── ffmpeg.exe
│   └── ffprobe.exe
│
├── utils/
│   ├── binaries.py
│   ├── progress.py
│   ├── keyframes.py
│   ├── video_utils.py
│   └── hevc_script.py
│
├── deprecated/
├── test_scripts/
├── build/
└── dist/
```

---

# Main Files

## `app.py`

Main backend entry point.

Usually launched by Tauri.

Handles:

* reading arguments
* running import workflows
* generating thumbnails
* returning final JSON

If imports are broken, start here.

---

## `requirements.txt`

Python dependencies for the backend.

Examples:

* av
* pillow
* numpy
* pyinstaller

---

## `backend_script.spec`

PyInstaller config used when packaging the backend executable.

---

# bin/

Bundled tools used by the backend.

## `ffmpeg.exe`

Used for:

* cutting clips
* exporting clips
* merging clips
* conversions

## `ffprobe.exe`

Used for:

* reading metadata
* stream info
* keyframe workflows

These are bundled so users do not need to install FFmpeg themselves.

---

# utils/

Shared helpers.

## `binaries.py`

Finds ffmpeg / ffprobe paths in both:

* development builds
* packaged builds

---

## `progress.py`

Sends progress updates back to Rust.

Example:

```txt
PROGRESS|50|Cutting scenes...
```

Frontend listens for this and updates the loading UI.

---

## `keyframes.py`

Handles keyframe extraction.

This powers the current import workflow.

Why keyframes are used:

* fast
* reliable
* no re-encode needed
* usually close enough to real cuts

---

## `video_utils.py`

General helpers shared across the backend.

Examples:

* merge short scenes
* reusable wrappers
* common utilities

---

## `hevc_script.py`

HEVC / H.265 related helpers.

Used for codec support checks and preview workflows.

---

# Scene Detection History

Older AMVerge versions used a custom scene detection system based on frame analysis.

It tested things like:

* grayscale frames
* edge detection
* frame similarity
* threshold logic

It could be more accurate sometimes, but it was slower and heavier.

## Why It Changed

Keyframe splitting turned out to be the better real-world solution.

Reasons:

* much faster imports
* simpler pipeline
* no full re-encode
* keyframes often happen near cuts / action changes
* users can merge clips afterward if needed

That tradeoff made more sense for editors.

---

# Current Import Flow

```txt
Read keyframes
→ Split clips
→ Generate thumbnails
→ Return metadata
```

Frontend then renders clips immediately.

---

# Important Output Rules

## stdout

Reserved for final JSON output.

Rust reads this and passes it to React.

## stderr

Used for:

* progress messages
* warnings
* debug info

Keeping these separate is important.

---

# build/ and dist/

Generated during packaging.

## `build/`

Temporary PyInstaller files.

## `dist/`

Final packaged backend output.

Usually contains:

* backend executable
* bundled dependencies

---

# deprecated/

Old systems and retired experiments.

Mostly previous scene detection logic.

Useful for reference, but not current production code.

---

# test_scripts/

Scratch scripts, experiments, and quick tests.

Useful during development.

---

# If You're Editing This Backend

## Imports / splitting logic

Check:

* `app.py`
* `utils/keyframes.py`

## Packaging

Check:

* `backend_script.spec`

## FFmpeg path issues

Check:

* `utils/binaries.py`

## Progress UI issues

Check:

* `utils/progress.py`

## HEVC support

Check:

* `utils/hevc_script.py`

---

# General Style Notes

This backend prefers:

* readable code
* stable outputs
* fast workflows
* practical solutions

If adding something new:

* keep stdout clean
* use stderr for logs/progress
* fail gracefully
* prefer simple solutions

---

# Summary

This backend is the media engine of AMVerge.

Frontend sends commands.
Backend does the heavy lifting.
Results come back as clean metadata.

The goal is simple: help users get usable clips quickly.
