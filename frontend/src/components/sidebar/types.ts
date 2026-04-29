// Shared sidebar types. Defines props, menu state, modal state, drag/drop state, and page types.
import type React from "react";

export type Page = "home" | "menu" | "settings";

export type SidebarProps = {
  activePage: Page;
  setActivePage: React.Dispatch<React.SetStateAction<Page>>;
  onSelectFolder: (folderId: string | null) => void;
  onToggleFolderExpanded: (folderId: string) => void;
  onCreateFolder: (name: string, parentFolderId: string | null) => void;
  onSelectEpisode: (episodeId: string) => void;
  onOpenEpisode: (episodeId: string) => void;
  onDeleteEpisode: (episodeId: string) => void | Promise<void>;
  onRenameEpisode: (episodeId: string, newName: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMoveEpisodeToFolder: (episodeId: string, folderId: string | null) => void;
  onMoveEpisode: (episodeId: string, folderId: string | null, beforeEpisodeId?: string) => void;
  onMoveFolder: (folderId: string, parentFolderId: string | null, beforeFolderId?: string) => void;
  onSortEpisodePanel: (direction: "asc" | "desc") => void;
  onClearEpisodePanelCache: () => void | Promise<void>;
};

export type EpisodePanelProps = Omit<SidebarProps, "activePage" | "setActivePage">;

export type EpisodeContextMenuState = {
  episodeId: string;
  x: number;
  y: number;
};

export type FolderContextMenuState = {
  folderId: string;
  x: number;
  y: number;
};

export type PanelContextMenuState = {
  x: number;
  y: number;
};

export type TextModalState = {
  title: string;
  initialValue: string;
  placeholder: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
};

export type ConfirmModalState = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export type PointerDragSource =
  | { type: "episode"; id: string }
  | { type: "folder"; id: string };

export type PointerDropTarget =
  | { kind: "root" }
  | { kind: "folder"; folderId: string }
  | { kind: "episode"; episodeId: string; folderId: string | null; insert: "before" | "after" }
  | { kind: "folder-reorder"; folderId: string; parentFolderId: string | null; insert: "before" | "after" };