// Main Episode Panel coordinator. Wires together structure, menus, drag/drop, keyboard shortcuts, and UI sections.
import type React from "react";
import { useRef, useState } from "react";

import EpisodePanelContextMenus from "./EpisodePanelContextMenus";
import EpisodePanelHeader from "./EpisodePanelHeader";
import EpisodePanelModals from "./EpisodePanelModals";
import EpisodePanelTree from "./EpisodePanelTree";

import useEpisodePanelDragDrop from "../hooks/useEpisodePanelDragDrop";
import useEpisodePanelMenus from "../hooks/useEpisodePanelMenus";
import useEpisodePanelStructure from "../hooks/useEpisodePanelStructure";

import type { EpisodePanelProps } from "../types";
import { useAppStateStore } from "../../../store/appStore";

export default function EpisodePanel(props: EpisodePanelProps) {
  const panelListRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const clickGestureRef = useRef<{ key: string | null; ts: number }>({
    key: null,
    ts: 0,
  });
  const lastClickedEpisodeRef = useRef<string | null>(null);

  const [nextSortDirection, setNextSortDirection] = useState<"asc" | "desc">("asc");
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());

  const episodes = useAppStateStore(s => s.episodes);
  const episodeFolders = useAppStateStore(s => s.episodeFolders);

  const selectedEpisodeId = useAppStateStore(s => s.selectedEpisodeId);
  const selectedFolderId = useAppStateStore(s => s.selectedFolderId);
  
  const {
    folderById,
    foldersByParentId,
    rootEpisodes,
    episodesByFolderId,
    flatEpisodeOrder,
  } = useEpisodePanelStructure({
    episodes: episodes,
    episodeFolders: episodeFolders,
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

    setMultiSelectedIds(new Set());
    lastClickedEpisodeRef.current = episodeId;
  };

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
    openClearConfirmModal,
  } = useEpisodePanelMenus({
    episodes: episodes,
    episodeFolders: episodeFolders,
    multiSelectedIds,
    setMultiSelectedIds,
    clearClickGesture,
    onSelectEpisode: props.onSelectEpisode,
    onSelectFolder: props.onSelectFolder,
    onCreateFolder: props.onCreateFolder,
    onRenameEpisode: props.onRenameEpisode,
    onRenameFolder: props.onRenameFolder,
    onClearEpisodePanelCache: props.onClearEpisodePanelCache,
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
    onMoveEpisode: props.onMoveEpisode,
    onMoveFolder: props.onMoveFolder,
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
          void props.onDeleteEpisode(id);
        }

        setMultiSelectedIds(new Set());
        return;
      }

      if (selectedEpisodeId) {
        e.preventDefault();
        void props.onDeleteEpisode(selectedEpisodeId);
        return;
      }

      if (selectedFolderId) {
        e.preventDefault();
        props.onDeleteFolder(selectedFolderId);
      }
    }
  };

  return (
    <div className="eps-container">
      <div className="episode-panel">
        <EpisodePanelHeader
          nextSortDirection={nextSortDirection}
          setNextSortDirection={setNextSortDirection}
          onSortEpisodePanel={props.onSortEpisodePanel}
          openNewFolderModal={openNewFolderModal}
          openClearConfirmModal={openClearConfirmModal}
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
              props.onSelectFolder(null);
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
            multiSelectedIds={multiSelectedIds}
            beginPointerDrag={beginPointerDrag}
            handleEpisodeClick={handleEpisodeClick}
            handleClickWithOptionalDouble={handleClickWithOptionalDouble}
            openContextMenu={openContextMenu}
            openFolderContextMenu={openFolderContextMenu}
            onOpenEpisode={props.onOpenEpisode}
            onSelectFolder={props.onSelectFolder}
            onToggleFolderExpanded={props.onToggleFolderExpanded}
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
          setContextMenu={setContextMenu}
          setFolderContextMenu={setFolderContextMenu}
          setPanelContextMenu={setPanelContextMenu}
          setMultiSelectedIds={setMultiSelectedIds}
          openNewFolderModal={openNewFolderModal}
          openRenameEpisodeModal={openRenameEpisodeModal}
          openRenameFolderModal={openRenameFolderModal}
          onDeleteEpisode={props.onDeleteEpisode}
          onDeleteFolder={props.onDeleteFolder}
          onMoveEpisodeToFolder={props.onMoveEpisodeToFolder}
        />
      </div>
    </div>
  );
}