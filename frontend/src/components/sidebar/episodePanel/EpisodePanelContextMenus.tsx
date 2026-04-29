// Episode Panel context menu renderer. Displays right-click menus for episodes, folders, and empty panel space.
import type React from "react";
import type {
  EpisodeContextMenuState,
  FolderContextMenuState,
  PanelContextMenuState,
} from "../types";

import { useAppStateStore } from "../../../store/appStore";

type EpisodePanelContextMenusProps = {
  contextMenu: EpisodeContextMenuState | null;
  folderContextMenu: FolderContextMenuState | null;
  panelContextMenu: PanelContextMenuState | null;

  multiSelectedIds: Set<string>;

  setContextMenu: React.Dispatch<React.SetStateAction<EpisodeContextMenuState | null>>;
  setFolderContextMenu: React.Dispatch<React.SetStateAction<FolderContextMenuState | null>>;
  setPanelContextMenu: React.Dispatch<React.SetStateAction<PanelContextMenuState | null>>;
  setMultiSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  openNewFolderModal: (parentFolderId: string | null) => void;
  openRenameEpisodeModal: (episodeId: string) => void;
  openRenameFolderModal: (folderId: string) => void;

  onDeleteEpisode: (episodeId: string) => void | Promise<void>;
  onDeleteFolder: (folderId: string) => void;
  onMoveEpisodeToFolder: (episodeId: string, folderId: string | null) => void;
};

export default function EpisodePanelContextMenus({
  contextMenu,
  folderContextMenu,
  panelContextMenu,
  multiSelectedIds,
  setContextMenu,
  setFolderContextMenu,
  setPanelContextMenu,
  setMultiSelectedIds,
  openNewFolderModal,
  openRenameEpisodeModal,
  openRenameFolderModal,
  onDeleteEpisode,
  onDeleteFolder,
  onMoveEpisodeToFolder,
}: EpisodePanelContextMenusProps) {
  const episodeFolders = useAppStateStore(s => s.episodeFolders);
  return (
    <>
      {panelContextMenu && (
        <div
          className="episode-context-menu"
          style={{ left: panelContextMenu.x, top: panelContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="episode-context-menu-item"
            onClick={() => {
              openNewFolderModal(null);
              setPanelContextMenu(null);
            }}
          >
            Add Folder
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          className="episode-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.episodeId) ? (
            <>
              <button
                type="button"
                className="episode-context-menu-item"
                onClick={() => {
                  for (const id of multiSelectedIds) {
                    void onDeleteEpisode(id);
                  }

                  setMultiSelectedIds(new Set());
                  setContextMenu(null);
                }}
              >
                Delete {multiSelectedIds.size} episodes
              </button>

              <div className="episode-context-menu-separator" />
              <div className="episode-context-menu-label">Move to</div>

              <button
                type="button"
                className="episode-context-menu-item"
                onClick={() => {
                  for (const id of multiSelectedIds) {
                    onMoveEpisodeToFolder(id, null);
                  }

                  setMultiSelectedIds(new Set());
                  setContextMenu(null);
                }}
              >
                Root
              </button>

              {episodeFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="episode-context-menu-item"
                  onClick={() => {
                    for (const id of multiSelectedIds) {
                      onMoveEpisodeToFolder(id, folder.id);
                    }

                    setMultiSelectedIds(new Set());
                    setContextMenu(null);
                  }}
                >
                  {folder.name}
                </button>
              ))}
            </>
          ) : (
            <>
              <button
                type="button"
                className="episode-context-menu-item"
                onClick={() => {
                  openRenameEpisodeModal(contextMenu.episodeId);
                  setContextMenu(null);
                }}
              >
                Rename
              </button>

              <button
                type="button"
                className="episode-context-menu-item"
                onClick={() => {
                  void onDeleteEpisode(contextMenu.episodeId);
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {folderContextMenu && (
        <div
          className="episode-context-menu"
          style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="episode-context-menu-item"
            onClick={() => {
              openRenameFolderModal(folderContextMenu.folderId);
              setFolderContextMenu(null);
            }}
          >
            Rename
          </button>

          <button
            type="button"
            className="episode-context-menu-item"
            onClick={() => {
              onDeleteFolder(folderContextMenu.folderId);
              setFolderContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
}