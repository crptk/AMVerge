

<!--
  Replace the logo path below with the correct relative path if needed.
  Example: ![AMVerge Logo](frontend/src/assets/AMverge_logo.png)
-->

<p align="center">
  <img src="frontend/src/assets/amverge_title_gif.gif" alt="AMVerge Logo" width="1440"/>
</p>

# AMVerge

**Fast desktop scene-splitting software for editors.**  
AMVerge detects scene boundaries, previews clips instantly, and lets users merge false cuts into seamless scenes before exporting.

---

## Features

- Fast scene detection and keyframe extraction
- Batch import/export of video clips
- Merge or export clips individually
- HEVC/H.265 codec detection and proxy generation
- Customizable UI themes


<p align="center">
  <img src="frontend/src/assets/scrolling_amverge_gif.gif" alt="Importing and Scene Detection" width="340"/>
  <img src="frontend/src/assets/color_amverge_gif.gif" alt="Importing and Scene Detection" width="340"/>
  <img src="frontend/src/assets/resizing_amverge_gif.gif" alt="Importing and Scene Detection" width="340"/>
<img src="frontend/src/assets/import_amverge_gif.gif" alt="Importing and Scene Detection" width="340"/>
</p>

---

## Architecture

```
Frontend (React/TypeScript)
        │
        ▼
  Tauri Bridge (Rust)
        │
        ▼
Backend (Python, FFmpeg)
```

- **Frontend:** Modern UI for importing, previewing, and exporting video clips.
- **Tauri Bridge:** Secure, high-performance communication between UI and backend.
- **Backend:** Handles scene detection, video processing, and batch operations.

---

## Repository Structure

```
AMVerge/
│
├── backend/         # Python backend (scene detection, FFmpeg, utils)
│   ├── utils/
│   ├── build/
│   ├── keyframe_clips/
│   ├── pipeline/
│   ├── search/
│   ├── storage/
│   ├── test/
│   ├── requirements.txt
│   └── ...
│
├── frontend/        # Frontend (React, Tauri, Rust)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   └── ...
│   ├── src-tauri/
│   │   ├── src/
│   │   └── ...
│   ├── public/
│   ├── package.json
│   └── ...
│
├── assets/      
├── documentation.md
├── README.md
└── ...
```

---

## Getting Started

1. **Install dependencies:**
   - Python 3.10+ (see `backend/requirements.txt`)
   - Node.js, npm (for frontend)
   - Rust (for Tauri)

2. **Setup backend:**
   - `cd backend`
   - `python -m venv venv`
   - `venv\Scripts\pip install -r requirements.txt`

3. **Setup frontend:**
   - `cd frontend`
   - `npm install`
   - `npm run tauri dev`

4. **Build backend executable (Windows):**
   - `pyinstaller backend_script.py --onedir --noconsole ...`