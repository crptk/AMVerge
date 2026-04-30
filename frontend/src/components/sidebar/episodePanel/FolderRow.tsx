import type React from "react";
import type { PointerDragSource } from "../types";
import { EpisodeFolder } from "../../../types/domain";

type Folder = EpisodeFolder;

type FolderRowProps = {
  folder: Folder;
  depth: number;
  isSelected: boolean;
  isDropTarget: boolean;

  beginPointerDrag: (
    source: PointerDragSource
  ) => (e: React.PointerEvent) => void;

  handleClickWithOptionalDouble: (opts: {
    key: string;
    onSingle: () => void;
    onDouble: () => void;
  }) => () => void;

  openFolderContextMenu: (folderId: string, e: React.MouseEvent) => void;
  onSelectFolder: (folderId: string | null) => void;
  onToggleFolderExpanded: (folderId: string) => void;
};

export default function FolderRow({
  folder,
  depth,
  isSelected,
  isDropTarget,
  beginPointerDrag,
  handleClickWithOptionalDouble,
  openFolderContextMenu,
  onSelectFolder,
  onToggleFolderExpanded,
}: FolderRowProps) {
  const folderRowClass =
    (isSelected
      ? "episode-panel-row folder-row is-selected"
      : "episode-panel-row folder-row") + (isDropTarget ? " is-drop-target" : "");

  return (
    <div
      className={folderRowClass}
      data-folder-id={folder.id}
      onPointerDown={beginPointerDrag({ type: "folder", id: folder.id })}
      onClick={handleClickWithOptionalDouble({
        key: `folder:${folder.id}`,
        onSingle: () => onSelectFolder(folder.id),
        onDouble: () => {
          onToggleFolderExpanded(folder.id);
          onSelectFolder(null);
        },
      })}
      onContextMenu={(e) => openFolderContextMenu(folder.id, e)}
      title={folder.name}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <button
        type="button"
        className={
          folder.isExpanded
            ? "episode-panel-caret is-expanded"
            : "episode-panel-caret"
        }
        draggable={false}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFolderExpanded(folder.id);
        }}
        aria-label={folder.isExpanded ? "Collapse folder" : "Expand folder"}
      >
        ▸
      </button>

      <span className="episode-panel-folder-name">{folder.name}</span>
    </div>
  );
}