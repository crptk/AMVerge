import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Event, listen } from "@tauri-apps/api/event";

import {
  applyThemeSettings,
  useGeneralSettingsStore,
  useThemeSettingsStore
} from "./store/settingsStore.ts"

import { hydrateEpisodesFromDisk, migrateOldEpisodePanelStorage } from "./hooks/hydrateEpisodesFromDisk.ts";
import AppLayout from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import Menu from "./pages/Menu";
import Settings from "./pages/Settings";
import LoadingOverlay from "./components/common/LoadingOverlay.tsx";

import { useUIStateStore } from "./store/UIStore.ts";
import { useAppStateStore } from "./store/appStore.ts";
import { useEpisodePanelRuntimeStore, clearEpisodePanelStores, useEpisodePanelMetadataStore } from "./store/episodeStore.ts";
import useEpisodePanelState from "./hooks/useEpisodePanelState";
import useImportExport from "./hooks/useImportExport";
import useDiscordRPC from "./hooks/useDiscordRPC";
import useHEVCSupport from "./hooks/useHEVCSupport";
import useDragDropImport from "./hooks/useDragDropImport";

function App() {
  // refs
  const gridRef = useRef<HTMLDivElement>(null);
  const windowWrapperRef = useRef<HTMLDivElement | null>(null);
  const mainLayoutWrapperRef = useRef<HTMLDivElement | null>(null);
  const userHasHEVC = useRef(false);
  const abortedRef = useRef(false);

  // states
  const generalSettings = useGeneralSettingsStore();

  const setClips = useAppStateStore(s => s.setClips);

  const setSelectedEpisodeId = useEpisodePanelRuntimeStore(s => s.setSelectedEpisodeId);

  const activePage = useUIStateStore(s => s.activePage);
  const setActivePage = useUIStateStore(s => s.setActivePage);
  const setIsDragging = useUIStateStore(s => s.setIsDragging);

  const loading = useAppStateStore(s => s.loading);
  const importedVideoPath = useAppStateStore(s => s.importedVideoPath);
  const sidebarEnabled = useUIStateStore(s => s.sidebarEnabled);
  const importToken = useAppStateStore(s => s.importToken);
  const episodesPath = useGeneralSettingsStore(s => s.episodesPath);

  const setOpenedEpisodeId = useEpisodePanelRuntimeStore(s => s.setOpenedEpisodeId);
  const setLastOpenedEpisodeId = useEpisodePanelMetadataStore(s => s.setLastOpenedEpisodeId);
  const setSelectedFolderId = useEpisodePanelRuntimeStore(s => s.setSelectedFolderId);
  const setVideoIsHEVC = useAppStateStore(s => s.setVideoIsHEVC);
  const setDividerOffsetPx = useUIStateStore(s => s.setDividerOffsetPx);
  const setProgress = useAppStateStore(s => s.setProgress);
  const setProgressMsg = useAppStateStore(s => s.setProgressMsg);
  const setExportPath = useGeneralSettingsStore(s => s.setExportPath);
  const themeSettings = useThemeSettingsStore();

  // PUT THIS INTO GENERALSETTINGS STORE UNDER THEIR SAME LOCAL STORAGE
  const [timelineEnabled, setTimelineEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem("amverge_timeline_enabled_v1");
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    applyThemeSettings(themeSettings);
  }, [themeSettings]);

  useEffect(() => {
    const run = async () => {
      migrateOldEpisodePanelStorage();
      await hydrateEpisodesFromDisk(episodesPath);
    };

    void run();
  }, [episodesPath]);

  const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  const lastOpenedEpisodeId = useEpisodePanelMetadataStore(s => s.lastOpenedEpisodeId);

  // Persisted UI state
  const setSidebarWidthPx = useUIStateStore(s => s.setSidebarWidthPx);

  // Import/export
  const { updateRPC } = useDiscordRPC(generalSettings, activePage);

  const {
    batchTotal,
    batchDone,
    batchCurrentFile,
    onImportClick,
    handleImport,
    handleExport,
    handlePickExportDir,
    handleBatchImport,
    handleDownloadSingleClip,
    handleAbort
  } = useImportExport({
    abortedRef,
    onRPCUpdate: updateRPC,
  });

  // Episode panel actions
  const {
    handleSelectFolder,
    handleMoveEpisodeToFolder,
    handleMoveEpisode,
    handleMoveFolder,
    handleSortEpisodePanel,
    handleRenameEpisode,
    handleRenameFolder,
    handleDeleteFolder,
    handleDeleteEpisode,
    handleCreateFolder,
    handleToggleFolderExpanded,
  } = useEpisodePanelState();

  // App-level hooks
  useHEVCSupport(userHasHEVC);

  // usePersistence(handleSelectEpisodeFromStorage);

  useDragDropImport({
    setIsDragging,
    handleImport,
    handleBatchImport,
  });

  // Episode selection
  function handleSelectEpisode(episodeId: string) {
    setSelectedEpisodeId(episodeId)
    setSelectedFolderId(null)

    const eps = useEpisodePanelRuntimeStore.getState().episodes;
    const episode = eps.find((e) => e.id === episodeId);
    setClips(episode ? episode.clips : []);
  }

  function handleOpenEpisode(episodeId: string) {
    const eps = useEpisodePanelRuntimeStore.getState().episodes;
    const episode = eps.find((e) => e.id === episodeId);
    if (!episode) return;

    setSelectedEpisodeId(episodeId)
    setOpenedEpisodeId(episodeId)
    setLastOpenedEpisodeId(episodeId)
    setSelectedFolderId(null)
    setClips(episode.clips)
  }

  // UI handlers
  function startSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!sidebarEnabled) return;

    const wrapper = windowWrapperRef.current;
    if (!wrapper) return;

    e.preventDefault();
    e.stopPropagation();

    const pointerId = e.pointerId;
    e.currentTarget.setPointerCapture(pointerId);
    document.body.classList.add("is-resizing-sidebar");

    const onPointerMove = (ev: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect();
      const minWidth = 220;
      const maxWidth = Math.max(minWidth, Math.floor(rect.width * 0.6));
      const proposed = Math.round(ev.clientX - rect.left);
      const clamped = Math.min(maxWidth, Math.max(minWidth, proposed));
      setSidebarWidthPx(clamped);
    };

    const stop = () => {
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  // Backend actions
  async function handleClearEpisodePanelCache() {
    try {
      await invoke("clear_episode_panel_cache", {
        customPath: episodesPath,
      });

      clearEpisodePanelStores();

      setClips([]);
    } catch (err) {
      console.error("Failed to clear episode panel cache:", err);
    }
  }

  // Effects
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      const stop = await listen<{ percent: number; message: string }>(
        "scene_progress",
        (event: Event<{ percent: number; message: string }>) => {
          setProgress(event.payload.percent);
          setProgressMsg(event.payload.message);
        }
      );

      unlisten = stop;
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);


  useEffect(() => {
    if (!importedVideoPath) {
      setVideoIsHEVC(null);
      return;
    }

    let cancelled = false;

    setVideoIsHEVC(null);

    (async () => {
      try {
        const hevc = await invoke<boolean>("check_hevc", {
          videoPath: importedVideoPath,
        });

        if (!cancelled) {
          setVideoIsHEVC(hevc);
        }
      } catch (err) {
        console.error("check_hevc failed:", err);

        if (!cancelled) {
          setVideoIsHEVC(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importedVideoPath, importToken]);

  useEffect(() => {
    const update = () => {
      const ww = windowWrapperRef.current;
      const ml = mainLayoutWrapperRef.current;

      if (!ww || !ml) return;

      const wwRect = ww.getBoundingClientRect();
      const mlRect = ml.getBoundingClientRect();

      const wwCenterY = wwRect.top + wwRect.height / 2;
      const mlCenterY = mlRect.top + mlRect.height / 2;
      const offsetPx = mlCenterY - wwCenterY;

      setDividerOffsetPx((prev) =>
        Math.abs(prev - offsetPx) < 0.5 ? prev : offsetPx
      );
    };

    update();

    const ro = new ResizeObserver(() => update());
    if (mainLayoutWrapperRef.current) {
      ro.observe(mainLayoutWrapperRef.current);
    }
    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activePage, sidebarEnabled]);

  // load episodes on startup
  useEffect(() => {
    if (openedEpisodeId) return;
    if (!lastOpenedEpisodeId) return;

    const eps = useEpisodePanelRuntimeStore.getState().episodes;
    if (eps.length === 0) return;

    const episode = eps.find((e) => e.id === lastOpenedEpisodeId);
    if (!episode) return;

    setSelectedEpisodeId(episode.id);
    setOpenedEpisodeId(episode.id);
    setSelectedFolderId(null);
    setClips(episode.clips);
  }, [
    openedEpisodeId,
    lastOpenedEpisodeId,
    setSelectedEpisodeId,
    setOpenedEpisodeId,
    setSelectedFolderId,
    setClips,
  ]);

  return (
    <AppLayout
      windowWrapperRef={windowWrapperRef}
      loadingOverlay={
        loading ? (
          <LoadingOverlay
            batchTotal={batchTotal}
            batchDone={batchDone}
            batchCurrentFile={batchCurrentFile}
            onAbort={handleAbort}
          />
        ) : null
      }
      onPointerDown={startSidebarResize}
      sidebarProps={{
        activePage,
        setActivePage,
        onSelectFolder: handleSelectFolder,
        onToggleFolderExpanded: handleToggleFolderExpanded,
        onCreateFolder: handleCreateFolder,
        onSelectEpisode: handleSelectEpisode,
        onOpenEpisode: handleOpenEpisode,
        onDeleteEpisode: handleDeleteEpisode,
        onRenameEpisode: handleRenameEpisode,
        onRenameFolder: handleRenameFolder,
        onDeleteFolder: handleDeleteFolder,
        onMoveEpisodeToFolder: handleMoveEpisodeToFolder,
        onMoveEpisode: handleMoveEpisode,
        onMoveFolder: handleMoveFolder,
        onSortEpisodePanel: handleSortEpisodePanel,
        onClearEpisodePanelCache: handleClearEpisodePanelCache,
      }}
      userHasHEVC={userHasHEVC.current}
    >
      <div className="main-content">
        {activePage === "home" ? (
          <HomePage
            onImportClick={onImportClick}
            mainLayoutWrapperRef={mainLayoutWrapperRef}
            gridRef={gridRef}
            handleExport={handleExport}
            userHasHEVC={userHasHEVC}
            onPickExportDir={handlePickExportDir}
            onExportDirChange={(dir: string) => setExportPath(dir || null)}
            onDownloadClip={handleDownloadSingleClip}
          />
        ) : activePage === "menu" ? (
          <Menu />
        ) : (
          <Settings />
        )}
      </div>
    </AppLayout>
  );
}

export default App;