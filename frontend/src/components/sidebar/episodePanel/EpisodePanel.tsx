// Main Episode Panel coordinator. Wires together structure, menus, drag/drop, keyboard shortcuts, and UI sections.
import type React from "react";
import { useEffect, useRef, useState } from "react";

import EpisodePanelContextMenus from "./EpisodePanelContextMenus";
import EpisodePanelHeader from "./EpisodePanelHeader";
import EpisodePanelModals from "./EpisodePanelModals";
import EpisodePanelTree from "./EpisodePanelTree";

import useEpisodePanelDragDrop from "../hooks/useEpisodePanelDragDrop";
import useEpisodePanelMenus from "../hooks/useEpisodePanelMenus";
import useEpisodePanelStructure from "../hooks/useEpisodePanelStructure";
import useEpisodePanelState from "../../../hooks/useEpisodePanelState";

import { useEpisodePanelMetadataStore, useEpisodePanelRuntimeStore } from "../../../stores/episodeStore";

export default function EpisodePanel() {
  const panelListRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const clickGestureRef = useRef<{ key: string | null; ts: number }>({
    key: null,
    ts: 0,
  });
  const lastClickedEpisodeRef = useRef<string | null>(null);

  const [nextSortDirection, setNextSortDirection] = useState<"asc" | "desc">("asc");
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());

  const episodeRuntimeState = useEpisodePanelRuntimeStore();
  const episodeMetadataState = useEpisodePanelMetadataStore();

  const episodes = episodeRuntimeState.episodes;
  const episodeFolders = episodeMetadataState.episodeFolders;
  const selectedEpisodeId = episodeRuntimeState.selectedEpisodeId;
  const selectedFolderId = episodeRuntimeState.selectedFolderId;
  const openedEpisodeId = episodeRuntimeState.openedEpisodeId;
  const lastOpenedEpisodeId = episodeMetadataState.lastOpenedEpisodeId;

  const {
    folderById,
    foldersByParentId,
    rootEpisodes,
    episodesByFolderId,
    flatEpisodeOrder,
  } = useEpisodePanelStructure({
    episodes,
    episodeFolders,
  });

  const clearClickGesture = () => {
    clickGestureRef.current = { key: null, ts: 0 };
  };

  const suppressNextClick = () => {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const handleClickWithOptionalDouble = (opts: {
    key: string;
    onSingle: () => void;
    onDouble: () => void;
  }) => {
    return () => {
      if (suppressClickRef.current) return;

      const now = Date.now();
      const state = clickGestureRef.current;
      const isSecondClick = state.key === opts.key && now - state.ts < 260;

      if (isSecondClick) {
        clearClickGesture();
        opts.onDouble();
        return;
      }

      clickGestureRef.current = { key: opts.key, ts: now };
      opts.onSingle();
    };
  };

  const handleEpisodeClick = (episodeId: string) => (e: React.MouseEvent) => {
    if (suppressClickRef.current) return;

    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      setMultiSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(episodeId)) next.delete(episodeId);
        else next.add(episodeId);
        return next;
      });
      lastClickedEpisodeRef.current = episodeId;
      return;
    }

    if (e.shiftKey && lastClickedEpisodeRef.current) {
      e.stopPropagation();
      const startIdx = flatEpisodeOrder.indexOf(lastClickedEpisodeRef.current);
      const endIdx = flatEpisodeOrder.indexOf(episodeId);

      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        setMultiSelectedIds(new Set(flatEpisodeOrder.slice(lo, hi + 1)));
      }

      return;
    }

    handleSelectEpisode(episodeId);
    setMultiSelectedIds(new Set());
    lastClickedEpisodeRef.current = episodeId;
  };

  const {
    handleSelectEpisode,
    handleOpenEpisode,
    handleSelectFolder,
    handleCreateFolder,
    handleRenameEpisode,
    handleRenameFolder,
    handleDeleteEpisode,
    handleDeleteFolder,
    handleSortEpisodePanel,
    handleMoveEpisodeToFolder,
    handleMoveEpisode,
    handleMoveFolder,
    handleToggleFolderExpanded,
  } = useEpisodePanelState();

  useEffect(() => {
    if (openedEpisodeId) return;
    if (!lastOpenedEpisodeId) return;
    if (!episodes.some((episode) => episode.id === lastOpenedEpisodeId)) return;

    handleOpenEpisode(lastOpenedEpisodeId);
  }, [episodes, openedEpisodeId, lastOpenedEpisodeId, handleOpenEpisode]);

  const {
    contextMenu,
    setContextMenu,
    folderContextMenu,
    setFolderContextMenu,
    panelContextMenu,
    setPanelContextMenu,
    textModal,
    setTextModal,
    confirmModal,
    setConfirmModal,
    textModalInputRef,
    openContextMenu,
    openFolderContextMenu,
    openPanelContextMenu,
    openNewFolderModal,
    openRenameEpisodeModal,
    openRenameFolderModal,
  } = useEpisodePanelMenus({
    episodes,
    episodeFolders,
    multiSelectedIds,
    setMultiSelectedIds,
    clearClickGesture,
    onSelectEpisode: handleSelectEpisode,
    onSelectFolder: handleSelectFolder,
    onCreateFolder: handleCreateFolder,
    onRenameEpisode: handleRenameEpisode,
    onRenameFolder: handleRenameFolder,
  });

  const menusOpen =
    Boolean(contextMenu) ||
    Boolean(folderContextMenu) ||
    Boolean(panelContextMenu) ||
    Boolean(textModal) ||
    Boolean(confirmModal);

  const { dropTarget, beginPointerDrag } = useEpisodePanelDragDrop({
    folderById,
    foldersByParentId,
    episodesByFolderId,
    rootEpisodes,
    multiSelectedIds,
    setMultiSelectedIds,
    clearClickGesture,
    suppressNextClick,
    menusOpen,
    onMoveEpisode: handleMoveEpisode,
    onMoveFolder: handleMoveFolder,
  });

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "F2") {
      if (selectedEpisodeId) {
        e.preventDefault();
        openRenameEpisodeModal(selectedEpisodeId);
        return;
      }

      if (selectedFolderId) {
        e.preventDefault();
        openRenameFolderModal(selectedFolderId);
      }

      return;
    }

    if (e.key === "Delete") {
      if (multiSelectedIds.size > 0) {
        e.preventDefault();

        for (const id of multiSelectedIds) {
          void handleDeleteEpisode(id);
        }

        setMultiSelectedIds(new Set());
        return;
      }

      if (selectedEpisodeId) {
        e.preventDefault();
        void handleDeleteEpisode(selectedEpisodeId);
        return;
      }

      if (selectedFolderId) {
        e.preventDefault();
        handleDeleteFolder(selectedFolderId);
      }
    }
  };

  return (
    <div className="eps-container">
      <div className="episode-panel">
        <EpisodePanelHeader
          nextSortDirection={nextSortDirection}
          setNextSortDirection={setNextSortDirection}
          onSortEpisodePanel={handleSortEpisodePanel}
          openNewFolderModal={openNewFolderModal}
          selectedEpisodeId={selectedEpisodeId}
          selectedFolderId={selectedFolderId}
          multiSelectedCount={multiSelectedIds.size}
          onDeleteSelectedEpisode={() => {
            if (multiSelectedIds.size > 0) {
              for (const id of multiSelectedIds) {
                void handleDeleteEpisode(id);
              }
              setMultiSelectedIds(new Set());
              return;
            }
            if (selectedEpisodeId) {
              void handleDeleteEpisode(selectedEpisodeId);
              return;
            }
            if (selectedFolderId) {
              handleDeleteFolder(selectedFolderId);
            }
          }}
        />

        <div
          className={
            dropTarget?.kind === "root"
              ? "episode-panel-list is-drop-target-root"
              : "episode-panel-list"
          }
          tabIndex={0}
          ref={panelListRef}
          onKeyDown={onPanelKeyDown}
          onMouseDown={() => panelListRef.current?.focus()}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleSelectFolder(null);
              setMultiSelectedIds(new Set());
            }
          }}
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return;
            openPanelContextMenu(e);
          }}
          data-episode-panel-root="true"
        >
          <EpisodePanelTree
            rootEpisodes={rootEpisodes}
            foldersByParentId={foldersByParentId}
            episodesByFolderId={episodesByFolderId}
            dropTarget={dropTarget}
            openedEpisodeId={openedEpisodeId}
            selectedEpisodeId={selectedEpisodeId}
            selectedFolderId={selectedFolderId}
            multiSelectedIds={multiSelectedIds}
            beginPointerDrag={beginPointerDrag}
            handleEpisodeClick={handleEpisodeClick}
            handleClickWithOptionalDouble={handleClickWithOptionalDouble}
            openContextMenu={openContextMenu}
            openFolderContextMenu={openFolderContextMenu}
            onOpenEpisode={handleOpenEpisode}
            onSelectFolder={handleSelectFolder}
            onToggleFolderExpanded={handleToggleFolderExpanded}
          />
        </div>

        <EpisodePanelModals
          textModal={textModal}
          confirmModal={confirmModal}
          textModalInputRef={textModalInputRef}
          setTextModal={setTextModal}
          setConfirmModal={setConfirmModal}
        />

        <EpisodePanelContextMenus
          contextMenu={contextMenu}
          folderContextMenu={folderContextMenu}
          panelContextMenu={panelContextMenu}
          multiSelectedIds={multiSelectedIds}
          episodeFolders={episodeFolders}
          setContextMenu={setContextMenu}
          setFolderContextMenu={setFolderContextMenu}
          setPanelContextMenu={setPanelContextMenu}
          setMultiSelectedIds={setMultiSelectedIds}
          openNewFolderModal={openNewFolderModal}
          openRenameEpisodeModal={openRenameEpisodeModal}
          openRenameFolderModal={openRenameFolderModal}
          onDeleteEpisode={handleDeleteEpisode}
          onDeleteFolder={handleDeleteFolder}
          onMoveEpisodeToFolder={handleMoveEpisodeToFolder}
        />
        <div className="episode-panel-notice">
          <div className="episode-panel-notice-text">
            <h4>WARNING</h4>
            <p>AMVerge V2 will revamp how episodes are stored, and all data 
              will be wiped. Please treat this episode panel as a temporary storage
              until then.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}