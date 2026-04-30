# sidebar

Welcome to the `sidebar` module.

This part of the AMVerge frontend handles navigation, project organization, and the Episode Panel system. If `clipsGrid` is where users work with scene clips, the sidebar is where users manage imported episodes, folders, cached sessions, and move around the app.

If you're here to debug, add features, or understand the structure, this guide should help you get productive quickly.

## What This Module Does

The sidebar is responsible for:

- Switching between pages like Home / Menu
- Displaying the Episode Panel
- Organizing imported episodes into folders
- Renaming, deleting, sorting, and moving episodes
- Drag and drop reordering
- Multi-select support
- Context menus
- Modal prompts (rename, create folder, clear cache)
- Keyboard shortcuts like Delete / F2

Think of it like a lightweight file explorer built specifically for AMVerge imported episodes/movies.

## Why It Is Split Into Multiple Files

Earlier versions of the sidebar were much larger single-file components, which works at first, but becomes harder to maintain as features grow.

This module is now split into:

- Small UI components
- Focused custom hooks
- Shared types

This makes it easier to:

- Debug specific systems
- Add features safely
- Reuse logic
- Keep `EpisodePanel.tsx` readable

## Architecture Overview

```txt
sidebar/
├── Sidebar.tsx
├── SidebarNav.tsx
├── types.ts
│
├── episodePanel/
│   ├── EpisodePanel.tsx
│   ├── EpisodePanelHeader.tsx
│   ├── EpisodePanelTree.tsx
│   ├── EpisodePanelModals.tsx
│   ├── EpisodePanelContextMenus.tsx
│   ├── EpisodeRow.tsx
│   └── FolderRow.tsx
│
└── hooks/
    ├── useEpisodePanelStructure.ts
    ├── useEpisodePanelMenus.ts
    └── useEpisodePanelDragDrop.ts
````

## File Breakdown

### Root Files

**`Sidebar.tsx`**
Main container for the entire sidebar.

Responsible for:

* Rendering navigation buttons
* Rendering the Episode Panel
* Passing shared props downward

Usually the entry point for this module.

**`SidebarNav.tsx`**
Renders page buttons like:

* Home
* Menu

Keeps navigation separate from episode management logic.

**`types.ts`**
Shared TypeScript definitions for the sidebar system.

Includes:

* `SidebarProps`
* `EpisodePanelProps`
* Context menu state types
* Modal state types
* Drag/drop types
* Page enums

If you're changing props across multiple files, start here.

### Episode Panel Files

**`EpisodePanel.tsx`**
Main coordinator for the Episode Panel.

It wires together:

* Structure hook
* Menu hook
* Drag/drop hook
* Header
* Tree renderer
* Menus
* Modals

Think of this as the controller.

**`EpisodePanelHeader.tsx`**
Top toolbar of the panel.

Contains actions like:

* Sort
* New Folder
* Clear Cache

**`EpisodePanelTree.tsx`**
Responsible for rendering the hierarchical tree.

Handles:

* Root folders
* Nested folders
* Episodes inside folders
* Recursive rendering

If folder visuals break, start here.

**`EpisodeRow.tsx`**
Single episode row.

Handles visual states like:

* selected
* opened
* multi-selected
* drop target highlight

**`FolderRow.tsx`**
Single folder row.

Handles:

* expand/collapse caret
* selected state
* drop target highlight

**`EpisodePanelModals.tsx`**
Renders modal overlays such as:

* Rename episode
* Rename folder
* New folder
* Confirm clear cache

Pure UI component.

**`EpisodePanelContextMenus.tsx`**
Right-click menus.

Handles:

* episode menus
* folder menus
* empty panel menus

Pure UI rendering component.

### Hooks

**`useEpisodePanelStructure.ts`**
Derived data hook.

Builds efficient structures from raw props:

* `folderById`
* `foldersByParentId`
* `episodesByFolderId`
* `rootEpisodes`
* `visibleEpisodeOrder`

Used for rendering and selection logic.

**`useEpisodePanelMenus.ts`**
Owns menu and modal state.

Handles:

* context menu open / close
* rename prompts
* new folder prompt
* clear cache confirm
* ESC close behavior
* click outside close behavior

If menus behave strangely, start here.

**`useEpisodePanelDragDrop.ts`**
Owns pointer drag/drop logic.

Handles:

* dragging folders
* dragging episodes
* multi-drag behavior
* reorder targets
* root drop targets
* commit move actions

This is the most sensitive logic in the module.

If editing it, test carefully.

## How State Flows

```
Sidebar.tsx
   ↓
EpisodePanel.tsx
   ↓
Hooks calculate state + handlers
   ↓
Small UI components render it
```

UI components should stay mostly dumb.

Hooks should own behavior.

## Keyboard Shortcuts

Currently supported:

* `Delete` → remove selected items
* `F2` → rename selected item

If adding more shortcuts, place them in `EpisodePanel.tsx`.

## Common Tasks

**Adding a new button**
Usually place it in `EpisodePanelHeader.tsx`

**Adding a right-click action**
Usually place it in `EpisodePanelContextMenus.tsx`

Then wire behavior through props/hooks.

**Adding tree visuals**
Usually place it in:

* `EpisodeRow.tsx`
* `FolderRow.tsx`
* `EpisodePanelTree.tsx`

**Performance feels slow**
Check:

* unnecessary rerenders
* large arrays rebuilt repeatedly
* missing `useMemo`
* drag handlers firing too often

**Drag/drop broke**
Start with:

`useEpisodePanelDragDrop.ts`

Then verify row data attributes:

* `data-folder-id`
* `data-episode-id`

These are important for hit detection.

## Philosophy

Keep this module feeling like a desktop file explorer:

* fast
* predictable
* keyboard friendly
* scalable
* easy to maintain

Whenever adding features, prefer:

* hooks for behavior
* small components for UI
* typed props
* minimal duplication