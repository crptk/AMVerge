# AMVerge Tauri Layer

This folder contains the native desktop layer for AMVerge.

AMVerge uses React/TypeScript for the frontend, Python for the video processing backend, and Tauri/Rust as the bridge between them. The Rust code in `main.rs` is mostly glue code. It receives commands from the frontend, starts the Python backend or FFmpeg tools, sends progress updates back to the UI, and handles native app paths/resources.

## What this layer does

`main.rs` is the main Tauri entrypoint for the desktop app. It handles:

- starting scene detection
- aborting scene detection while it is running
- sending progress events to the frontend
- exporting selected clips
- merging selected clips into one video
- checking if a video uses HEVC/H.265
- generating browser-friendly preview proxies for clips that do not preview well in the webview
- cleaning temporary episode/cache folders
- resolving bundled binaries like `ffmpeg.exe`, `ffprobe.exe`, and the packaged Python backend

The frontend calls these Rust functions through Tauri commands.

## Folder structure

```txt
src-tauri/
├── bin/
├── capabilities/
├── gen/
├── icons/
├── src/
│   ├── lib.rs
│   └── main.rs
├── target/
├── .gitignore
├── build.rs
├── Cargo.lock
├── Cargo.toml
└── tauri.conf.json
```

### `src/main.rs`

Main native entrypoint for AMVerge.

This file registers the Tauri app, plugins, shared state, and all commands used by the frontend.

Main command groups:

#### Scene detection

`detect_scenes(...)`

Starts the Python backend and passes it the input video path and output cache folder.

In development mode, it runs:

```txt
backend/venv/Scripts/python.exe backend/app.py
```

In production mode, it runs the bundled backend executable from Tauri resources:

```txt
bin/backend_script-x86_64-pc-windows-msvc/backend_script.exe
```

The Python backend writes final JSON to `stdout` and progress messages to `stderr` using this format:

```txt
PROGRESS|percent|message
```

Rust listens for those progress lines and emits this frontend event:

```txt
scene_progress
```

The frontend uses that event to update the loading/progress UI.

#### Abort scene detection

`abort_detect_scenes(...)`

Stops the active Python backend process.

On Windows, this uses `taskkill /F /T /PID <pid>` so it also kills any child FFmpeg processes started by the backend.

#### Exporting clips

`export_clips(...)`

Exports selected clips using FFmpeg.

It supports two modes:

1. **Separate clips**
   - Exports each selected clip into its own file.
   - Uses stream copy when the clip is already After Effects friendly.
   - Falls back to H.264/AAC re-encode when needed.

2. **Merged export**
   - Creates one combined video from all selected clips.
   - Uses FFmpeg concat and re-encodes to a broadly compatible MP4.

Exports also emit `scene_progress` events so the frontend can show progress and elapsed time.

#### Codec checks

`check_hevc(...)`

Uses `ffprobe` to check the first video stream codec.

Returns `true` when the video is HEVC/H.265.

This helps the frontend decide when a preview proxy may be needed.

#### Preview proxies

`ensure_preview_proxy(...)`

Creates a `.preview.mp4` beside the original clip.

This is used when a clip does not preview correctly in the Tauri webview, usually because of codec support issues like HEVC.

The proxy is encoded as H.264/AAC MP4 so it works better in the browser/webview preview grid.

This command also uses per-clip async locks so the app does not accidentally start multiple proxy encodes for the same clip at the same time.

#### Preview error logging

`hover_preview_error(...)`

Logs preview errors reported by the frontend.

This is mostly for debugging unsupported preview cases.

#### Cache cleanup

`delete_episode_cache(...)`

Deletes a single episode cache folder.

`clear_episode_panel_cache(...)`

Deletes the full `episodes/` cache folder inside the app data directory.

## Shared state

### `ActiveSidecar`

Tracks the process ID of the currently running Python backend.

Used so `abort_detect_scenes` knows what process tree to kill.

### `PreviewProxyLocks`

Stores one async lock per clip path.

Used to prevent duplicate preview proxy encodes for the same clip.

## Progress events

The Rust layer sends progress to the frontend using the Tauri event:

```txt
scene_progress
```

Payload shape:

```ts
{
  percent: number;
  message: string;
}
```

This event is used for both scene detection and exports.

## Bundled tools

The app depends on these binaries:

- `ffmpeg.exe`
- `ffprobe.exe`
- packaged Python backend executable

`resolve_bundled_tool(...)` looks for FFmpeg/FFprobe in a few places:

1. Tauri resources under `bin/`
2. the packaged backend `_internal/` folder
3. local dev folders while running in development mode

This makes the same Rust command code work in both development and production builds.

## Development vs production behavior

### Development

When running in debug mode, scene detection uses the local Python backend:

```txt
backend/app.py
backend/venv/Scripts/python.exe
```

This makes backend development easier because changes to Python can be tested without rebuilding the full packaged backend.

### Production

When running in release mode, scene detection uses the packaged backend executable bundled with the Tauri app.

This lets users run AMVerge without installing Python themselves.

## Logging

Console logs use this format:

```txt
AMVERGE|tag|message
```

The logs are kept single-line and try to show filenames instead of full local file paths. This makes logs easier to screenshot and safer to share.

## `src/lib.rs`

This file is currently the default Tauri starter-style entrypoint. If the app is using `main.rs` directly, `lib.rs` is likely unused.

It can stay for now, but it may be removed or cleaned up later if the project no longer needs it.

## `bin/`

Stores bundled native binaries/resources used by the app.

Common contents include:

- FFmpeg
- FFprobe
- packaged Python backend output

These files are needed so AMVerge can process videos on a user's machine without requiring them to manually install video tools.

## `capabilities/`

Stores Tauri permission/capability files.

This controls what the frontend is allowed to access through Tauri, such as dialogs, filesystem access, shell/plugin access, and other native permissions.

## `icons/`

App icons used by Tauri for the installed desktop app.

## `tauri.conf.json`

Main Tauri configuration file.

This controls app metadata, build settings, bundle settings, resource inclusion, window behavior, updater settings, and security-related config.

## `Cargo.toml` and `Cargo.lock`

Rust dependency and lock files.

`Cargo.toml` declares the Rust/Tauri dependencies.

`Cargo.lock` locks exact dependency versions for reproducible builds.

## `build.rs`

Tauri build script.

This is part of the normal Tauri project setup and helps generate/build the native app correctly.

## `target/`

Rust build output folder.

This is generated by Cargo and should not be edited manually.

## Notes for future cleanup

`main.rs` is intentionally kept as one file right now so the app is easy to understand and drop in.

A future refactor could probably be:

```txt
src/
├── main.rs
├── commands/
│   ├── scene_detection.rs
│   ├── export.rs
│   ├── preview_proxy.rs
│   └── cache.rs
├── ffmpeg.rs
├── paths.rs
├── logging.rs
└── state.rs
```

That is not required right now. The current structure is fine as long as the app stays understandable and stable.
