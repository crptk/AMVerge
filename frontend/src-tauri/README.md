# AMVerge Tauri Layer

This folder contains the native desktop layer for AMVerge.

AMVerge uses React/TypeScript for the frontend, Python for the video processing backend, and Tauri/Rust as the bridge between them.

The Rust side has now been refactored into multiple focused modules instead of one large `main.rs`.

## What this layer does

The Tauri layer handles:

- starting scene detection
- aborting scene detection while running
- exporting selected clips
- merging selected clips
- checking codecs (HEVC / H.265)
- generating preview proxy videos
- deleting cache folders
- moving episode storage folders
- listing default storage directories
- saving background images
- sending progress events to the frontend
- resolving bundled binaries like FFmpeg / FFprobe / Python backend

Frontend React code communicates with these Rust functions using Tauri commands.

---

# Folder structure

```txt
src-tauri/
├── bin/
├── capabilities/
├── icons/
├── src/
│   ├── main.rs
│   ├── payloads.rs
│   ├── state.rs
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── scenes.rs
│   │   ├── export.rs
│   │   ├── preview.rs
│   │   ├── cache.rs
│   │   └── settings.rs
│   └── utils/
│       ├── mod.rs
│       ├── binaries.rs
│       ├── logging.rs
│       └── paths.rs
├── Cargo.toml
├── Cargo.lock
├── build.rs
└── tauri.conf.json
````

---

# Core files

## `src/main.rs`

Main Tauri entrypoint.

Responsibilities:

* starts the app
* registers plugins
* initializes shared state
* exposes all frontend commands
* wires modules together

This file should stay small and mostly act as the app bootstrapper.

---

## `src/payloads.rs`

Contains reusable event payload structs.

Example:

```rust
ProgressPayload {
  percent: u8,
  message: String
}
```

Used when Rust emits progress updates to React.

---

## `src/state.rs`

Contains shared app state stored inside Tauri.

Examples:

### `ActiveSidecar`

Tracks the running Python backend process so scene detection can be aborted.

### `PreviewProxyLocks`

Prevents multiple proxy encodes for the same clip path.

---

# Commands

All frontend callable Rust functions live inside `commands/`.

---

## `commands/scenes.rs`

Handles scene detection.

### `detect_scenes(...)`

Starts Python backend:

Development:

```txt
backend/venv/Scripts/python.exe backend/app.py
```

Production:

```txt
bin/backend_script/backend_script.exe
```

The backend returns:

* final JSON on stdout
* progress updates on stderr

Progress format:

```txt
PROGRESS|percent|message
```

Rust converts this into frontend event:

```txt
scene_progress
```

---

### `abort_detect_scenes(...)`

Kills active backend process.

On Windows uses:

```txt
taskkill /F /T /PID <pid>
```

This also kills child FFmpeg processes.

---

## `commands/export.rs`

Handles clip exporting.

### `export_clips(...)`

Supports:

### Separate clips

Exports each clip individually.

Uses stream copy when possible.

Falls back to re-encode when needed.

### Merged export

Combines selected clips into one final file.

Uses FFmpeg concat + re-encode.

Also emits progress events.

---

## `commands/preview.rs`

Handles preview compatibility.

### `check_hevc(...)`

Uses `ffprobe` to determine if video codec is HEVC/H.265.

Returns boolean.

Used by frontend to know if browser preview may fail.

---

### `ensure_preview_proxy(...)`

Creates:

```txt
clip.preview.mp4
```

Proxy uses H.264/AAC for better Tauri webview compatibility.

Uses internal locks so duplicate proxy generation cannot happen simultaneously.

---

### `hover_preview_error(...)`

Logs preview failures sent from frontend.

Useful for debugging user systems/codecs.

---

## `commands/cache.rs`

Handles cache deletion.

### `delete_episode_cache(...)`

Deletes one episode folder.

### `clear_episode_panel_cache(...)`

Deletes the full episodes storage folder.

Supports custom storage directory if user selected one.

---

## `commands/settings.rs`

Handles storage paths + general settings filesystem tasks.

### `get_default_episodes_dir(...)`

Returns default AMVerge storage path:

```txt
AppData/.../episodes
```

---

### `move_episodes_to_new_dir(...)`

Moves all existing episode folders from old path to new path.

Used when user changes storage directory inside settings.

Supports:

* same-drive rename/move
* cross-drive copy + delete fallback

---

### `save_background_image(...)`

Copies selected custom background image into:

```txt
AppData/.../backgrounds
```

So frontend can reliably load it later.

---

# Utilities

## `utils/binaries.rs`

Resolves bundled tools.

Finds:

* ffmpeg.exe
* ffprobe.exe
* packaged Python backend

Checks multiple locations so both dev + production builds work.

---

## `utils/logging.rs`

Central logging helpers.

Keeps logs clean, readable, and safe to share.

Example format:

```txt
AMVERGE|tag|message
```

---

## `utils/paths.rs`

Contains path helpers.

Examples:

* sanitize episode IDs
* normalize paths
* safe folder joins
* filesystem helpers

---

# Frontend storage behavior

## Selected storage directory

Saved in frontend localStorage via theme settings:

```txt
episodesPath
```

This stores where future imports + cache folders should go.

---

## Episode panel state

Saved separately in localStorage:

```txt
amverge_episode_panel_v1
```

Stores:

* episode list
* folders
* selected episode
* selected folder

This lets UI restore previous session quickly.

---

# Progress events

Rust sends frontend progress using:

```txt
scene_progress
```

Payload:

```ts
{
  percent: number,
  message: string
}
```

Used during:

* scene detection
* exporting

---

# Asset protocol / local files

Tauri serves local files to frontend through:

```ts
convertFileSrc(...)
```

Used for:

* thumbnails
* clip previews
* proxy previews
* custom backgrounds

If users choose custom storage folders, asset protocol scope must allow those folders.

---

# Development vs Production

## Development

Uses local Python backend.

Fast iteration.

## Production

Uses packaged backend executable.

No Python install required for users.

---

# Why the refactor helps

Old version:

```txt
main.rs = everything
```

New version:

```txt
main.rs = bootstrap only
commands = frontend callable logic
utils = reusable helpers
state = shared runtime state
payloads = event structs
```

Benefits:

* easier debugging
* easier to scale
* easier onboarding contributors
* cleaner code ownership
* simpler future features

---

# Future possible growth

```txt
commands/
├── episodes.rs
├── diagnostics.rs
├── updater.rs
├── metadata.rs
```

```txt
utils/
├── ffmpeg.rs
├── thumbnails.rs
├── filesystem.rs
```

---

# Summary

AMVerge's Rust layer is now a clean modular bridge between:

```txt
React UI
↓
Tauri Commands
↓
Rust Logic
↓
Python + FFmpeg
↓
Filesystem / Native OS
```

This keeps frontend simple while Rust handles native power efficiently.