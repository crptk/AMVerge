// Recursive Episode Panel tree renderer. Displays folders, nested folders, and episode rows.
import React from "react";
import EpisodeRow from "./EpisodeRow";
import FolderRow from "./FolderRow";
import type { EpisodePanelProps, PointerDragSource, PointerDropTarget } from "../types";

type Episode = EpisodePanelProps["episodes"][number];
type Folder = EpisodePanelProps["episodeFolders"][number];

type EpisodePanelTreeProps = {
  rootEpisodes: Episode[];
  foldersByParentId: Map<string | null, Folder[]>;
  episodesByFolderId: Map<string, Episode[]>;
  dropTarget: PointerDropTarget | null;

  openedEpisodeId: string | null;
  selectedEpisodeId: string | null;
  selectedFolderId: string | null;
  multiSelectedIds: Set<string>;

  beginPointerDrag: (
    source: PointerDragSource
  ) => (e: React.PointerEvent) => void;

  handleEpisodeClick: (episodeId: string) => (e: React.MouseEvent) => void;

  handleClickWithOptionalDouble: (opts: {
    key: string;
    onSingle: () => void;
    onDouble: () => void;
  }) => () => void;

  openContextMenu: (episodeId: string, e: React.MouseEvent) => void;
  openFolderContextMenu: (folderId: string, e: React.MouseEvent) => void;

  onOpenEpisode: (episodeId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onToggleFolderExpanded: (folderId: string) => void;
};

export default function EpisodePanelTree({
  rootEpisodes,
  foldersByParentId,
  episodesByFolderId,
  dropTarget,
  openedEpisodeId,
  selectedEpisodeId,
  selectedFolderId,
  multiSelectedIds,
  beginPointerDrag,
  handleEpisodeClick,
  handleClickWithOptionalDouble,
  openContextMenu,
  openFolderContextMenu,
  onOpenEpisode,
  onSelectFolder,
  onToggleFolderExpanded,
}: EpisodePanelTreeProps) {
  const renderEpisodeRow = (
    episode: Episode,
    folderId: string | null,
    depth: number
  ) => {
    const isDrop =
      dropTarget?.kind === "episode" &&
      dropTarget.episodeId === episode.id;

    return (
      <EpisodeRow
        key={episode.id}
        episode={episode}
        folderId={folderId}
        depth={depth}
        openedEpisodeId={openedEpisodeId}
        selectedEpisodeId={selectedEpisodeId}
        multiSelectedIds={multiSelectedIds}
        isDropTarget={isDrop}
        beginPointerDrag={beginPointerDrag}
        handleEpisodeClick={handleEpisodeClick}
        openContextMenu={openContextMenu}
        onOpenEpisode={onOpenEpisode}
      />
    );
  };

  const renderFolder = (folder: Folder, depth: number) => {
    const folderEpisodes = episodesByFolderId.get(folder.id) ?? [];
    const childFolders = foldersByParentId.get(folder.id) ?? [];

    const isDropFolder =
      (dropTarget?.kind === "folder" && dropTarget.folderId === folder.id) ||
      (dropTarget?.kind === "folder-reorder" && dropTarget.folderId === folder.id);

    return (
      <div key={folder.id} className="episode-panel-folder">
        <FolderRow
          folder={folder}
          depth={depth}
          isSelected={selectedFolderId === folder.id}
          isDropTarget={isDropFolder}
          beginPointerDrag={beginPointerDrag}
          handleClickWithOptionalDouble={handleClickWithOptionalDouble}
          openFolderContextMenu={openFolderContextMenu}
          onSelectFolder={onSelectFolder}
          onToggleFolderExpanded={onToggleFolderExpanded}
        />

        {folder.isExpanded && (childFolders.length > 0 || folderEpisodes.length > 0) && (
          <div className="episode-panel-folder-children">
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {folderEpisodes.map((episode) =>
              renderEpisodeRow(episode, folder.id, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };
  const rootFolders = foldersByParentId.get(null) ?? [];

  return (
    <>
      {rootFolders.map((folder) => renderFolder(folder, 0))}

      {rootEpisodes.map((episode) =>
        renderEpisodeRow(episode, null, 0)
      )}
    </>
  );
}