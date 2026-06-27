# AMVerge — Agent & Developer Reference

> **Keep this file up to date.** Whenever you add a Tauri command, a new Zustand store, a new Python function, a new CI cache, or change the architecture in any meaningful way, update the relevant section here. This file is the source of truth for AI assistants and new contributors.

---

## What Is AMVerge?

AMVerge is a cross-platform desktop app for video clip management. It takes a long video, automatically detects scene cuts at keyframes, splits it into individual clips, lets the user select which clips to keep, then exports them — optionally merged — to mp4/mkv/mov, or imports them directly into DaVinci Resolve, After Effects, CapCut, or Premiere Pro.

Current version: **1.2.4**  
Bundle identifier: `com.amiri.amverge`

---

## Architecture

The app has three layers. They communicate in a strict top-down direction:

```
┌─────────────────────────────────────────────────┐
│  React + TypeScript (Vite)                      │  ← UI layer
│  frontend/src/                                  │
└───────────────┬─────────────────────────────────┘
                │  Tauri IPC (invoke / listen)
┌───────────────▼─────────────────────────────────┐
│  Rust (Tauri v2)                                │  ← Bridge layer
│  frontend/src-tauri/src/                        │
└───────────────┬─────────────────────────────────┘
                │  stdin/stdout/stderr (spawned process)
┌───────────────▼─────────────────────────────────┐
│  Python sidecar (PyInstaller binary)            │  ← Compute layer
│  backend/                                       │
│  Bundled as backend_script inside the app       │
└─────────────────────────────────────────────────┘
```

The **React layer** calls Tauri commands via `invoke()`. The **Rust layer** either handles the request itself (export, preview, editor import, settings) or spawns the **Python sidecar** (scene detection). The Python sidecar communicates back via:
- **stderr**: line-prefixed events (`PROGRESS|`, `INITIAL_CLIPS_READY|`, `THUMBNAIL_READY|`, `PAIR_RESULT|`, `PROCESSING_COMPLETE`)
- **stdout**: final JSON result (array of scene objects)

FFmpeg is bundled inside the Python sidecar's `_internal/` directory and called via `subprocess`.

---

## Directory Structure

```
AMVergeNew/
├── backend/                    # Python sidecar source
│   ├── app.py                  # Entry point: scene detection pipeline
│   ├── requirements.txt        # Python dependencies
│   ├── backend_script.spec     # PyInstaller spec
│   ├── bin/                    # FFmpeg/FFprobe binaries (gitignored in CI)
│   ├── discordrpc/             # Discord RPC server (rpc_server.py)
│   ├── methods/                # Additional processing methods
│   └── utils/
│       ├── binaries.py         # Binary path resolution
│       ├── cs_scenedetect.py   # Scene similarity comparison (CLIP embeddings)
│       ├── keyframes.py        # Keyframe extraction
│       ├── progress.py         # emit_event() helper (writes prefixed lines to stderr)
│       └── video_utils.py      # FFmpeg wrappers, duration, keyframe generation
│
├── frontend/
│   ├── package.json            # Node deps (React 19, Zustand 5, Tauri plugins)
│   ├── vite.config.ts
│   ├── scripts/
│   │   ├── build-sidecar.mjs   # Runs PyInstaller, outputs to src-tauri/bin/
│   │   └── merge-universal-macos-app.mjs  # lipo merge for macOS universal binary
│   │
│   ├── src/                    # React source
│   │   ├── App.tsx             # Root component; wires up Tauri event listeners
│   │   ├── MainLayout.tsx      # Top-level layout (sidebar + content)
│   │   ├── components/         # UI components
│   │   ├── features/export/    # Export profiles, NLE targets, icon utilities
│   │   ├── hooks/              # useImportExport, useDiscordRPC, useHEVCSupport, etc.
│   │   ├── pages/              # HomePage, Settings, Menu
│   │   ├── stores/             # Zustand state (see State Management section)
│   │   ├── types/domain.ts     # ClipItem, EpisodeEntry, EpisodeFolder
│   │   └── utils/              # appConsole, episodeUtils, episodePersistStorage
│   │
│   └── src-tauri/              # Rust/Tauri source
│       ├── Cargo.toml          # Rust deps (tauri 2, tokio, reqwest, serde, etc.)
│       ├── tauri.conf.json     # Base Tauri config (app ID, updater endpoint, CSP)
│       ├── tauri.windows.conf.json
│       ├── tauri.macos.conf.json         # arm64 macOS
│       ├── tauri.macos.intel.conf.json   # x86_64 macOS
│       ├── tauri.macos.universal.conf.json
│       ├── tauri.linux.conf.json
│       ├── bin/                # Sidecar binaries (output of build-sidecar.mjs)
│       └── src/
│           ├── main.rs         # App entry: registers all Tauri commands, manages state
│           ├── lib.rs          # Unused stub (Tauri template artifact, ignore)
│           ├── state.rs        # Shared Tauri state structs (ActiveSidecar, ExportAbortState, etc.)
│           ├── payloads.rs     # Serde event payload types
│           ├── commands/       # One file per feature group (see Rust Commands section)
│           └── utils/          # ffmpeg.rs, paths.rs, process.rs, logging.rs
│
├── .github/workflows/
│   ├── release-multi-platform.yml  # Main release pipeline (see CI/CD section)
│   ├── release-windows-only.yml
│   ├── mac-dev-build.yml
│   └── ci.yml
│
└── AGENTS.md                   # ← This file
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| UI framework | React | 19 |
| Build tool | Vite | 7 |
| Language (frontend) | TypeScript | ~5.8 |
| State management | Zustand | 5 |
| Desktop framework | Tauri | 2 |
| Language (bridge) | Rust | stable |
| Async runtime | Tokio | 1 |
| Language (compute) | Python | 3.11 |
| Packaging (Python) | PyInstaller | latest |
| Media processing | FFmpeg | bundled |
| Scene detection | PySceneDetect + OpenCV | - |
| Similarity model | OpenCLIP (CLIP embeddings) + FAISS | - |
| Video decoding (thumbs) | PyAV | - |
| Discord integration | pypresence | - |

---

## Tauri Commands (IPC Bridge)

All commands are registered in `frontend/src-tauri/src/main.rs`. Each command group lives in its own file under `commands/`.

### Scene Detection (`commands/scenes.rs`)

| Command | Description |
|---------|-------------|
| `detect_scenes(video_path, episode_cache_id?, custom_path?)` | Spawns Python sidecar, streams events to frontend, returns JSON string of scenes |
| `abort_detect_scenes()` | Kills sidecar process group (SIGKILL on Unix, taskkill on Windows) |

**Dev mode**: spawns `backend/venv/bin/python backend/app.py`  
**Prod mode**: spawns `resources/bin/backend_script-{target}/backend_script`

### Export (`commands/export.rs`)

| Command | Description |
|---------|-------------|
| `export_clips(...)` | FFmpeg-based clip export (copy/encode, multi-file) |
| `abort_export()` | Kills all active FFmpeg export processes |
| `detect_nvidia_encoder_profile()` | Tests NVENC availability |
| `detect_gpu_encoder_capabilities()` | Probes all GPU encoders (NVENC, AMF, VideoToolbox) |
| `fast_merge(...)` | Concatenates clips via FFmpeg concat demuxer |
| `fast_split(...)` | Splits a clip at a timestamp |

### Preview (`commands/preview.rs`)

| Command | Description |
|---------|-------------|
| `check_hevc()` | Checks if system can decode HEVC |
| `get_audio_streams(path)` | Returns audio stream info via FFprobe |
| `hover_preview_error(...)` | Reports preview errors to console |
| `ensure_preview_proxy(...)` | Creates a low-res proxy for HEVC preview |
| `ensure_merged_preview(...)` | Merges selected clips for preview playback |

### Editor Import (`commands/editor_import.rs`)

| Command | Description |
|---------|-------------|
| `import_media_to_editor(target, clips, ...)` | Copies/links clips and generates NLE project file |
| `abort_editor_import()` | Cancels in-progress import |

Supported NLE targets: `davinciResolve`, `afterEffects`, `capcut`, `premierePro`  
Target implementations: `frontend/src/features/export/targets/`

### Other Commands

| File | Commands |
|------|---------|
| `commands/bug_report.rs` | `submit_bug_report()` — HMAC-signed POST to bug report API |
| `commands/notifications.rs` | `fetch_startup_notification()` — polls notifications API |
| `commands/cache.rs` | `delete_episode_cache()`, `clear_episode_panel_cache()` |
| `commands/settings.rs` | `save_background_image()`, `crop_and_save_image()`, `crop_and_save_profile_icon()`, `delete_profile_icon_file()`, `reveal_in_file_manager()`, `move_episodes_to_new_dir()`, `get_default_episodes_dir()` |
| `commands/discord.rs` | `start_discord_rpc()`, `update_discord_rpc()`, `stop_discord_rpc()` |

---

## Tauri Events (Rust → React)

Events emitted by Rust that React listens to:

| Event name | Payload | Source |
|------------|---------|--------|
| `scene_progress` | `{ percent: u8, message: string }` | Python stderr `PROGRESS|n|msg` |
| `initial_clips_ready` | `{ clips_json: string }` | Python stderr `INITIAL_CLIPS_READY|json` |
| `thumbnail_ready` | `{ position: u32 }` | Python stderr `THUMBNAIL_READY|n` |
| `pair_result` | `{ pos_a: u32, pos_b: u32, should_merge: bool }` | Python stderr `PAIR_RESULT|a|b|0or1` |
| `processing_complete` | `()` | Python stderr `PROCESSING_COMPLETE` |

The React layer listens to all these in `App.tsx` or the relevant hook.

---

## Python Sidecar — Scene Detection Pipeline

Entry point: `backend/app.py` → `main()` → `trim_scenes_at_keyframes()`

**Pipeline stages:**

1. **Keyframe extraction** (10–40%): Uses FFprobe/FFmpeg to find keyframe timestamps in the video (`utils/keyframes.py`)
2. **Scene cutting** (50%): Runs `ffmpeg -f segment` to split video at keyframe timestamps. Chunked in batches of 1500 cuts to stay under Windows 32,767-char command line limit.
3. **Scene collection** (75%): Builds a list of scene dicts with `{ scene_index, start, end, path, thumbnail, original_file }`
4. **Thumbnail generation** (90%): Multi-threaded (up to 4 workers). Uses PyAV to decode first keyframe of each clip, saves as JPEG. First 24 thumbnails emit `INITIAL_CLIPS_READY`, rest stream as `THUMBNAIL_READY` events.
5. **Similarity check**: As adjacent thumbnails complete, compares pairs using CLIP embeddings (`utils/cs_scenedetect.py`). Emits `PAIR_RESULT` for each pair — frontend uses this to suggest merging similar adjacent clips.
6. **Output**: Final scene list JSON printed to stdout. Rust reads this, returns to React.

**Python stdout/stderr protocol:**
- `stderr`: all logging + events (prefixed lines)
- `stdout`: only the final JSON (one print at the end)

---

## State Management (Frontend)

All state is managed with Zustand. Persisted stores use `localStorage` via `zustand/middleware/persist`.

| Store | File | Persisted | Purpose |
|-------|------|-----------|---------|
| `useAppStateStore` | `stores/appStore.ts` | No | Active clips, loading state, progress, HEVC flag, batch state |
| `useAppPersistedStore` | `stores/appStore.ts` | Yes (`amverge_export_dir_v1`) | Export dir, dismissed notification IDs |
| `useGeneralSettingsStore` | `stores/settingsStore.ts` | Yes (`amverge.generalSettings.v2`) | Episodes path, export format, export profiles, Discord RPC settings |
| `useThemeSettingsStore` | `stores/settingsStore.ts` | Yes (`amverge.theme.v2`) | Accent color, background image, blur, clip tile aspect |
| `useEpisodeStore` | `stores/episodeStore.ts` | Yes | Episode entries and folder tree |
| `useUIStore` | `stores/UIStore.ts` | No | Modal open/close, sidebar state |

**Core domain types** (`types/domain.ts`):
- `ClipItem` — a single video clip (id, src, thumbnail, startSec, endSec, sceneIndex)
- `EpisodeEntry` — a processed video with its clips array and metadata
- `EpisodeFolder` — folder for organizing episodes in the sidebar tree

---

## Export Profiles

Defined in `frontend/src/features/export/profiles.ts`.  
An `ExportProfile` contains: codec, bitrate, resolution, fps, hardware encoder preference, custom icon, etc.  
Multiple profiles can be created. Active profile ID is stored in `useGeneralSettingsStore`.

Export targets (NLE formats) in `frontend/src/features/export/targets/`:
- `davinciResolve.ts` — generates DaVinci Resolve EDL/XML
- `afterEffects.ts` — generates After Effects project
- `capcut.ts` — generates CapCut draft
- `premier_pro.ts` — generates Premiere Pro XML

---

## Key Conventions

### Adding a new Tauri command
1. Add the function in the appropriate `commands/*.rs` file with `#[tauri::command]`
2. Register it in `main.rs` inside `tauri::generate_handler![...]`
3. Call it from React with `invoke("command_name", { args })`
4. Update this file under "Tauri Commands"

### Adding a new Zustand store or field
1. Add to the appropriate store in `stores/`
2. If it's persisted and changes the shape, bump the `name` key (e.g., `v2` → `v3`) to avoid hydration errors
3. Update this file under "State Management"

### Adding a new Python utility
1. Add to `backend/utils/`
2. Import in `backend/app.py` if it's part of the pipeline
3. If it requires a new Python package, add to `backend/requirements.txt`
4. The Python venv cache in CI will auto-invalidate on `requirements.txt` change

### Modifying the Python sidecar event protocol
Events are line-prefixed strings written to stderr by `backend/utils/progress.py`.  
If you add a new event type:
1. Write it in Python: `emit_event("MY_EVENT", payload)`
2. Parse it in Rust in `commands/scenes.rs` inside the stderr reader loop
3. Emit it as a Tauri event: `app.emit("my_event", payload)`
4. Listen for it in React

---

## Development — Running Locally

### Prerequisites
- Node.js 20+, npm
- Rust (stable)
- Python 3.11
- FFmpeg in `backend/bin/` (for Python dev mode)
- `cargo install tauri-cli --version '^2.0'` or `cargo binstall tauri-cli`

### Setup

```bash
# 1. Install frontend deps
cd frontend
npm install

# 2. Set up Python venv
cd ../backend
python -m venv venv
venv/Scripts/pip install -r requirements.txt  # Windows
# venv/bin/pip install -r requirements.txt   # macOS/Linux

# 3. Build Python sidecar (only needed if running prod mode locally)
cd ../frontend
npm run build:sidecar

# 4. Run in dev mode (Python sidecar runs as script, not binary)
npm run tauri:dev
```

Dev mode requires a `.env` file at the repo root with the API secrets (see secrets table in CI section).

### Dev vs Prod sidecar

In `debug_assertions` mode (dev), Rust spawns `backend/venv/bin/python backend/app.py` directly.  
In release mode, Rust looks for the bundled binary at `resources/bin/backend_script-{target}/backend_script`.  
The path fallback logic is in `commands/scenes.rs:find_existing_backend_path()`.

---

## CI/CD Pipeline

### Workflows

| File | Trigger | Purpose |
|------|---------|---------|
| `release-multi-platform.yml` | `v*` tag or manual | Full release: Windows + macOS Universal DMG |
| `release-windows-only.yml` | Manual | Windows-only release (faster for Windows patches) |
| `mac-dev-build.yml` | Manual | macOS dev build (no notarization) |
| `ci.yml` | PR / push | Lint/type-check only |

### Release Pipeline Job Graph

```
build-macos-arch (matrix: arm64 + x86_64)
  └─► package-universal-macos (lipo merge + notarize)
        └─► publish-release
build-windows ──────────────────────────────────────► publish-release
```

### Caching Strategy

| Component | Mechanism | Cache Key | Invalidates when |
|-----------|-----------|-----------|-----------------|
| npm packages | `actions/setup-node` `cache: npm` | `package-lock.json` hash | package-lock.json changes |
| Rust artifacts | `Swatinem/rust-cache@v2` | Cargo.lock + toolchain (+ `rust_target` on macOS) | Cargo.lock or toolchain changes |
| Python venv | `actions/cache@v4` | `runner.os + rust_target + requirements.txt` hash | requirements.txt changes |
| FFmpeg binaries | `actions/cache@v4` | `ffmpeg-{platform/target}-v1` | Manual key bump |

**Tauri CLI** is installed via `cargo binstall` (pre-compiled binary, ~30s) rather than `cargo install` (~5–10 min compile).

### Updating FFmpeg in CI

FFmpeg cache keys are pinned with a version suffix. To pull a new FFmpeg version:
1. Find both cache key lines in `release-multi-platform.yml`:
   - Windows: `key: ffmpeg-windows-x64-v1`
   - macOS: `key: ffmpeg-${{ matrix.rust_target }}-v1`
2. Bump suffix: `v1` → `v2`
3. Next CI run will download fresh FFmpeg and cache it under the new key

### Uncacheable Steps (irreducible build time floor)

- **Apple Notarization** (`xcrun notarytool submit --wait`): Apple server call, ~2–5 min
- **Universal binary merge**: `lipo` + re-sign every binary in sidecar
- **Final Tauri bundle** (`cargo tauri build`): Rust cache skips dep compilation but final link + NSIS/DMG packaging always runs

**Estimated build times:**

| Cache state | Windows | macOS (per arch) | Wall time |
|-------------|---------|-----------------|-----------|
| Cold (first run) | ~15 min | ~12 min | ~30 min |
| Warm (cache hit) | ~5–7 min | ~4–6 min | ~15 min |

### Re-running Failed Jobs

In the GitHub Actions UI: Actions tab → workflow run → dropdown next to "Re-run all jobs" → **"Re-run failed jobs"**. Only reruns failed jobs; skips already-passed ones.

### Required Secrets

| Secret | Used by |
|--------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | All build jobs (updater `.sig` generation) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | All build jobs |
| `APPLE_CERTIFICATE` | `package-universal-macos` |
| `APPLE_CERTIFICATE_PASSWORD` | `package-universal-macos` |
| `APPLE_SIGNING_IDENTITY` | `package-universal-macos` |
| `APPLE_ASC_KEY_ID` | `package-universal-macos` (notarization) |
| `APPLE_ASC_ISSUER_ID` | `package-universal-macos` |
| `APPLE_ASC_API_KEY_BASE64` | `package-universal-macos` |
| `APPLE_NOTARY_TEAM_ID` | `package-universal-macos` |
| `AMVERGE_NOTIFICATIONS_API_URL` | All build jobs |
| `AMVERGE_NOTIFICATIONS_API_KEY` | All build jobs |
| `AMVERGE_BUG_REPORT_API_URL` | All build jobs |
| `AMVERGE_BUG_REPORT_API_KEY` | All build jobs |
| `AMVERGE_BUG_REPORT_KEY_ID` | All build jobs |
| `AMVERGE_BUG_REPORT_SIGNING_SECRET` | All build jobs |
| `VITE_ADMIN_API_URL` | All build jobs |

---

## Auto-Updater

The app uses `tauri-plugin-updater`. On startup it checks:
```
https://github.com/crptk/AMVerge/releases/latest/download/latest.json
```
`latest.json` is generated and uploaded by the `publish-release` CI job. It contains per-platform download URLs and `.sig` signatures verified against the public key in `tauri.conf.json`.

---

## Known Quirks

- `frontend/src-tauri/src/lib.rs` contains a stub `greet` function from the Tauri project template. It is not used — the real entry point is `main.rs`. Do not add real code to `lib.rs`.
- On Windows, the Python backend sets `creationflags=CREATE_NO_WINDOW` on all subprocess calls to prevent console windows from flashing.
- FFmpeg is called with `aac` audio codec (not copy) in the segmenter to ensure consistent audio across clips.
- The `segment_times` argument can exceed Windows command-line limits for very long videos with many keyframes. The backend chunks cuts in batches of 1500 to work around this.
- macOS Intel builds run on `macos-14` with Rosetta 2 — Apple Silicon runners are used for both matrix jobs but cross-compile for x86_64.
