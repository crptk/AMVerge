````md id="yg79gm"
# Contributing to AMVerge

Thanks for your interest in contributing to AMVerge.

AMVerge is an open-source desktop tool focused on fast scene selection, previewing, and export workflows for editors.

## Ways to Contribute

- Report bugs
- Suggest features
- Improve UI / UX
- Fix bugs
- Improve performance
- Improve docs
- Refactor code
- Add tests
- Improve accessibility
- Improve cross-platform support

---

## Before You Start

Please check existing Issues before opening a new one.

For larger features, workflow changes, or architecture updates, open an Issue first so direction can be discussed before development starts.

If you plan to work on something, comment on the Issue first so work is not duplicated.

---

## Project Stack

- Frontend: React + TypeScript
- Desktop Shell: Tauri (Rust)
- Backend Processing: Python
- Media Tools: FFmpeg / FFprobe / PyAV

---

## Local Setup

```bash
git clone <repo-url>
cd AMVerge
````

Install frontend dependencies:

```bash
cd frontend
npm install
```

Install backend dependencies:

```bash
cd ../backend
pip install -r requirements.txt
```

Run development build:

```bash
cd ../frontend
npm run tauri dev
```

---

## Branching Workflow

Please branch from the **development** branch, not main.

Example:

```bash
git checkout development
git pull origin development
git checkout -b feature/my-change
```

Use clear branch names:

```bash
feature/export-quality-slider
fix/merge-stutter
docs/readme-update
refactor/sidebar-cleanup
```

---

## Pull Request Rules

### One Feature Per PR

Please keep each pull request focused on one feature or one fix.

Good examples:

* Add export bitrate slider
* Fix merge stutter issue
* Improve sidebar folder drag/drop
* Update backend README

Avoid:

* Export changes + UI redesign + docs rewrite in one PR

Small focused PRs are easier to review, test, and merge.

---

### Only Touch What Is Necessary

Please only modify files related to your change.

This helps reduce merge conflicts and keeps review clean.

Example:

If fixing sidebar logic, avoid unrelated changes in backend or styles.

---

### PR Target Branch

Open pull requests into:

```txt
development
```

Not `main`.

If review passes, changes will be merged into `development` first.

---

## Code Style

* Keep code readable
* Prefer clear naming over clever code
* Match existing project patterns
* Avoid unnecessary dependencies
* Keep components modular
* Keep hooks focused
* Avoid giant multi-purpose files

---

## For Performance Changes

Please explain:

* what changed
* why it helps
* any tradeoffs
* where it was measured (if possible)

---

## For UI Changes

Include screenshots or short clips.

Especially helpful for:

* layout changes
* animations
* settings screens
* sidebar changes

---

## For Backend Changes

Please mention if it affects:

* import speed
* keyframe detection
* export speed
* thumbnails
* codec compatibility
* memory usage

---

## Pull Request Process

1. Fork repo
2. Sync `development`
3. Create a feature branch
4. Make focused changes
5. Commit clearly
6. Open PR into `development`
7. Wait for review

---

## Important Notes

This project uses React + Tauri + Python.

Some changes affect multiple layers, so please test where relevant.

Examples:

* UI change may need frontend only
* Export change may affect frontend + Rust + Python
* File path changes may affect packaging

If unsure where logic belongs, ask first in an Issue.

---

## Respect the Codebase

Please avoid:

* random formatting-only PRs
* mass renames with no reason
* changing unrelated files
* adding dependencies casually
* rewriting working systems without discussion

---

## Be Respectful

Constructive and respectful collaboration only.

Good communication matters as much as good code.

---

## Thanks

Every bug fix, feature, doc improvement, and thoughtful PR helps AMVerge grow.
