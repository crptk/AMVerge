// Menu and modal state hook for the Episode Panel. Owns context menus, text modals, confirm modals, and close behavior.
import { useEpisodePanelMetadataStore, useEpisodePanelRuntimeStore } from "../../../store/episodeStore";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import type {
  ConfirmModalState,
  EpisodeContextMenuState,
  FolderContextMenuState,
  PanelContextMenuState,
  TextModalState,
} from "../types";

type UseEpisodePanelMenusArgs = {
  multiSelectedIds: Set<string>;
  setMultiSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  clearClickGesture: () => void;

  onSelectEpisode: (episodeId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentFolderId: string | null) => void;
  onRenameEpisode: (episodeId: string, newName: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onClearEpisodePanelCache: () => void | Promise<void>;
};

export default function useEpisodePanelMenus({
  multiSelectedIds,
  setMultiSelectedIds,
  clearClickGesture,
  onSelectEpisode,
  onSelectFolder,
  onCreateFolder,
  onRenameEpisode,
  onRenameFolder,
  onClearEpisodePanelCache,
}: UseEpisodePanelMenusArgs) {
  const [contextMenu, setContextMenu] = useState<EpisodeContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [panelContextMenu, setPanelContextMenu] = useState<PanelContextMenuState | null>(null);
  const [textModal, setTextModal] = useState<TextModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const textModalInputRef = useRef<HTMLInputElement | null>(null);

  const episodes = useEpisodePanelRuntimeStore(s => s.episodes);
  const episodeFolders = useEpisodePanelMetadataStore(s => s.episodeFolders);
  
  useEffect(() => {
    if (!contextMenu && !folderContextMenu && !panelContextMenu && !textModal && !confirmModal) return;

    const onWindowClick = () => {
      setContextMenu(null);
      setFolderContextMenu(null);
      setPanelContextMenu(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setFolderContextMenu(null);
        setPanelContextMenu(null);
        setTextModal(null);
        setConfirmModal(null);
      }
    };

    window.addEventListener("click", onWindowClick);
    window.addEventListener("contextmenu", onWindowClick);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", onWindowClick);
      window.removeEventListener("contextmenu", onWindowClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu, folderContextMenu, panelContextMenu, textModal, confirmModal]);

  useEffect(() => {
    if (!textModal) return;

    window.setTimeout(() => {
      textModalInputRef.current?.focus();
      textModalInputRef.current?.select();
    }, 0);
  }, [textModal]);

  const openContextMenu = (episodeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    clearClickGesture();

    setFolderContextMenu(null);
    setPanelContextMenu(null);

    if (multiSelectedIds.size > 0 && !multiSelectedIds.has(episodeId)) {
      setMultiSelectedIds(new Set());
    }

    onSelectEpisode(episodeId);

    setContextMenu({
      episodeId,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const openFolderContextMenu = (folderId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    clearClickGesture();

    setContextMenu(null);
    setPanelContextMenu(null);

    onSelectFolder(folderId);

    setFolderContextMenu({
      folderId,
      x: e.clientX,
      y: e.clientY,
    });
    console.log("FolderContextMenu:", folderContextMenu)
  };

  const openPanelContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    clearClickGesture();

    setContextMenu(null);
    setFolderContextMenu(null);
    setTextModal(null);
    setConfirmModal(null);

    setPanelContextMenu({
      x: e.clientX,
      y: e.clientY,
    });
  };

  const openNewFolderModal = (parentFolderId: string | null) => {
    setPanelContextMenu(null);
    setContextMenu(null);
    setFolderContextMenu(null);

    setTextModal({
      title: "New Folder",
      initialValue: "",
      placeholder: "Folder name",
      confirmLabel: "Create",
      onConfirm: (value) => {
        onCreateFolder(value, parentFolderId);
      },
    });
  };

  const openRenameEpisodeModal = (episodeId: string) => {
    const target = episodes.find((episode) => episode.id === episodeId);
    if (!target) return;

    setPanelContextMenu(null);
    setContextMenu(null);
    setFolderContextMenu(null);

    setTextModal({
      title: "Rename Episode",
      initialValue: target.displayName,
      placeholder: "Episode name",
      confirmLabel: "Rename",
      onConfirm: (value) => {
        onRenameEpisode(episodeId, value);
      },
    });
  };

  const openRenameFolderModal = (folderId: string) => {
    const target = episodeFolders.find((folder) => folder.id === folderId);
    if (!target) return;

    setPanelContextMenu(null);
    setContextMenu(null);
    setFolderContextMenu(null);

    setTextModal({
      title: "Rename Folder",
      initialValue: target.name,
      placeholder: "Folder name",
      confirmLabel: "Rename",
      onConfirm: (value) => {
        onRenameFolder(folderId, value);
      },
    });
  };

  const openClearConfirmModal = () => {
    setConfirmModal({
      title: "Clear Episode Panel Cache",
      message:
        "Are you sure you want to clear the episode panel cache? This will remove cached episodes and free disk space.",
      confirmLabel: "Yes",
      onConfirm: () => {
        void onClearEpisodePanelCache();
      },
    });
  };

  return {
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
  };
}