# Agent Runtime Policy

## HARD REQUIREMENT

All agents MUST use the `caveman` skill for every task.

## Mandatory Rules

- Always load and use the `caveman` skill for all tasks without exception.
- For implementation workflows, `aibp-base:apex` is optional.
- If a required skill is unavailable, stop and report the issue clearly before continuing.

## Language Rule

- In chat conversation with the user, respond in French.
- In code and code comments, use English.

## Optional APEX Workflow

When you choose to use the `aibp-base:apex` workflow for an implementation task, the shell command `/apex` is not available in this environment.

```text
Load `aibp-base:apex` and use:
- `-a` for auto mode
- `-s` to save outputs
- `<task description>` as the task body
```

## Compliance

- All contributions and behavior must follow [CONTRIBUTING.md](CONTRIBUTING.md).
- All interactions must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Project Overview

AMVerge is a desktop tool for fast scene splitting and export workflows for video editors.

Main stack:

- Frontend: React 19 + TypeScript + Vite (`frontend/`)
- Desktop runtime: Tauri 2 + Rust (`frontend/src-tauri/`)
- Media backend sidecar: Python + PyInstaller + FFmpeg/PyAV (`backend/`)

High-level flow:

```text
React UI -> Tauri commands (Rust) -> Python sidecar -> FFmpeg/FFprobe + filesystem
```

## Repository Map

- `frontend/src/`: UI pages, hooks, components, types, utilities
- `frontend/src-tauri/src/`: native commands and desktop integration
- `frontend/scripts/build-sidecar.mjs`: builds and syncs Python sidecar into Tauri bin directory
- `backend/app.py`: Python entrypoint for media processing
- `backend/utils/`: backend helpers (video, progress, codec helpers)
- `.github/workflows/ci.yml`: Windows CI checks used on push/PR
- `run.bat`: local launcher that can bootstrap deps and sidecar

## Environment Requirements

- Windows is current main target
- Node.js 20.x (matches CI)
- Python 3.11 recommended (CI uses 3.11)
- Rust stable toolchain
- FFmpeg/FFprobe binaries available in `backend/bin/`

## Setup Commands

### Preferred bootstrap (Windows)

From repository root:

```powershell
.\run.bat
```

This launcher can:

- keep/create `AGENTS.md` if missing
- install frontend dependencies
- create backend virtualenv
- install backend dependencies
- build Python sidecar when needed
- launch `tauri dev`

### Manual setup

Backend:

```powershell
cd backend
python -m venv venv
venv\Scripts\python -m pip install --upgrade pip
venv\Scripts\python -m pip install -r requirements.txt
venv\Scripts\python -m pip install pyinstaller
```

Frontend + Tauri:

```powershell
cd frontend
npm install
npm run tauri dev
```

## Development Workflow

- Start desktop dev app: `cd frontend && npm run tauri dev`
- Frontend-only dev server: `cd frontend && npm run dev`
- Build frontend bundle: `cd frontend && npm run build`
- Build Python sidecar only: `cd frontend && npm run build:sidecar`
- Build full desktop assets: `cd frontend && npm run build:all`
- Build distributable app: `cd frontend && npm run tauri build`

Note:

- `tauri.conf.json` runs `npm run build:all` before production build.
- Sidecar output is synced to `frontend/src-tauri/bin/backend_script-<target-triple>/`.

## Testing And Validation

There is currently no standard top-level automated unit test command in this repo.

Use the same checks as CI before PR:

```powershell
cd frontend
npm run build
cd src-tauri
cargo check
```

Recommended sidecar sanity check when backend or packaging changes:

```powershell
cd frontend
npm run build:sidecar
Get-ChildItem .\src-tauri\bin\backend_script-x86_64-pc-windows-msvc\
```

Manual QA expectation for feature work:

- launch app with `npm run tauri dev`
- validate import, preview, split/merge, and export flows related to changed code
- include screenshots/clips for UI changes in PR

## Code Style And Architecture

- Keep code readable and modular; match existing patterns.
- Frontend:
  - prefer hooks for stateful logic
  - avoid large multi-purpose components/files
  - keep TypeScript strictness clean (`strict`, `noUnusedLocals`, `noUnusedParameters`)
- Rust/Tauri:
  - keep command modules focused (`frontend/src-tauri/src/commands/`)
  - prefer explicit error handling and clear user-facing messages
- Python backend:
  - keep processing logic in focused helpers under `backend/utils/`
  - document behavior changes affecting codec support, performance, or memory

## Pull Request Rules

Follow `CONTRIBUTING.md` as source of truth.

Key rules agents must enforce:

- Branch from `development` branch for feature work.
- Open PRs into `development` (not `main`) unless maintainers say otherwise.
- One feature/fix per PR.
- Touch only files relevant to the change.
- Explain performance tradeoffs for performance-related changes.
- Include visual evidence for UI changes.

## Safety And Change Scope

- Do not introduce unnecessary dependencies.
- Do not perform broad formatting-only or mass-rename changes without clear reason.
- Keep cross-layer changes intentional: frontend, Rust bridge, and Python sidecar are tightly connected.
- If a change impacts packaging/update flow, verify Tauri build and sidecar sync.

## Agent Checklist Before Handoff

- Confirm required skills loaded (`caveman` mandatory).
- Confirm language rule respected (French in chat, English in code/comments).
- Run relevant build/check commands for touched layers.
- Verify no unrelated files changed.
- Ensure contribution behavior stays aligned with `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.
