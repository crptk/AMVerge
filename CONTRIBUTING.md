# Contributing to AMVerge

Thanks for your interest in contributing to AMVerge!

AMVerge is an open-source desktop tool focused on fast scene selection, previewing, and export workflows for editors.

## Ways to Contribute

- Report bugs
- Suggest features
- Improve UI/UX
- Fix bugs
- Improve performance
- Improve docs
- Refactor code
- Add tests

## Before You Start

Please check existing Issues before opening a new one.

For larger features or architecture changes, open an Issue first so we can discuss direction before implementation.

## Project Stack

- Frontend: React + TypeScript
- Desktop Shell: Tauri (Rust)
- Backend Processing: Python
- Media Tools: FFmpeg / FFprobe

## Local Setup

```bash
git clone <repo-url>
cd AMVerge
````

Install frontend deps:

```bash
cd frontend
npm install
```

Install backend deps:

```bash
cd ../backend
pip install -r requirements.txt
```

Run dev environment:

```bash
cd ../frontend
npm run tauri dev
```

## Contribution Guidelines

### Keep Pull Requests Focused

Small PRs are preferred over huge mixed PRs.

Good:

* Fix export bug
* Improve scene grid spacing
* Speed up preview loading

Bad:

* Rewrite UI + backend + packaging together

### Code Style

* Keep code readable
* Prefer clear naming over clever code
* Match existing project patterns
* Avoid unnecessary dependencies

### For Performance Changes

Please explain:

* what changed
* why it helps
* any tradeoffs

### For UI Changes

Include screenshots or video clips.

### For Backend Changes

Explain if it affects:

* scene detection
* export speed
* preview generation
* file compatibility

## Pull Request Process

1. Fork repo
2. Create branch:

```bash
feature/my-change
fix/export-bug
docs/readme-update
```

3. Commit clearly
4. Open PR with description
5. Wait for review

## Important

Because this project uses React + Tauri + Python, some changes may require testing across multiple layers.

If unsure where logic belongs, ask in an Issue first.

## Be Respectful

Constructive and respectful collaboration only.