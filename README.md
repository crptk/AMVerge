<p align="center">
  <img src="frontend/src/assets/amverge_title_gif.gif" alt="AMVerge Logo" width="1440"/>
</p>

# AMVerge

**Fast desktop scene-splitting software for editors.**  
AMVerge helps editors turn long videos into usable clips quickly. Import a video, split it into scenes, preview results instantly, merge false cuts if needed, and export only what you want.

---

## Features

- Fast keyframe-based scene splitting
- Instant clip previewing
- Batch clip export
- Merge selected clips into seamless scenes
- Folder + episode organization system
- HEVC / H.265 support detection
- Proxy preview workflows for unsupported codecs
- Resizable desktop-style interface
- Customizable themes / UI settings

<p align="center">
  <img src="frontend/src/assets/scrolling_amverge_gif.gif" alt="Scrolling through clips" width="340"/>
  <img src="frontend/src/assets/color_amverge_gif.gif" alt="Theme customization" width="340"/>
  <img src="frontend/src/assets/resizing_amverge_gif.gif" alt="Resizable layout" width="340"/>
  <img src="frontend/src/assets/import_amverge_gif.gif" alt="Import workflow" width="340"/>
</p>

---

## How It Works

```txt
Frontend (React + TypeScript)
          ↓
Desktop Layer (Tauri + Rust)
          ↓
Backend (Python)
          ↓
FFmpeg / FFprobe / PyAV
````

### Frontend

Handles:

* importing videos
* previewing clips
* selection workflows
* exporting clips
* sidebar organization
* UI settings

### Tauri Layer

Handles:

* desktop packaging
* secure command bridge
* filesystem access
* progress events

### Backend

Handles:

* keyframe extraction
* clip splitting
* thumbnail generation
* export / merge workflows
* codec support helpers

---

## Why Keyframes?

Older scene detection experiments used frame-by-frame analysis.

The current version uses keyframes because it is:

* much faster
* simpler
* practical for real editors
* no full re-encode on import
* easy to correct with merge tools afterward

---

## Repository Structure

```txt
AMVerge/
│
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── backend_script.spec
│   ├── bin/
│   │   ├── ffmpeg.exe
│   │   └── ffprobe.exe
│   ├── utils/
│   │   ├── binaries.py
│   │   ├── progress.py
│   │   ├── keyframes.py
│   │   ├── video_utils.py
│   │   └── hevc_script.py
│   ├── deprecated/
│   ├── test_scripts/
│   ├── build/
│   └── dist/
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── clipsGrid/
│   │   │   ├── previewPanel/
│   │   │   └── sidebar/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── styles/
│   │   ├── types/
│   │   └── utils/
│   ├── src-tauri/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── README.md
└── documentation.md
```

---

## Getting Started

## Requirements

Install:

* Python 3.10+
* Node.js + npm
* Rust
* Windows (current main target)

---

## Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

---

## Frontend Setup

```bash
cd frontend
npm install
npm run tauri dev
```

---

## Build Desktop App

```bash
npm run tauri build
```

---

## Build Python Sidecar Manually (Optional)

```bash
cd backend
pyinstaller backend_script.spec
```

---

## Notes

### `backend/deprecated/`

Contains older scene detection systems and retired experiments.

### `backend/bin/`

Bundled FFmpeg tools used by the backend.

### `frontend/src/components/sidebar/`

Contains the project management / episode organization system.

---

## Current Focus

AMVerge is built around speed and workflow efficiency.

The goal is simple:

* get clips fast
* review clips fast
* export only what matters

---

## Summary

AMVerge is a desktop utility for editors who want fast scene extraction without bloated workflows.

Import. Preview. Merge. Export.
