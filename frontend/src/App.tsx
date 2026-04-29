import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Event, listen } from "@tauri-apps/api/event";

import {
  applyThemeSettings,
  useGeneralSettingsStore,
  useThemeSettingsStore
} from "./store/settingsStore.ts"

import AppLayout from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import Menu from "./pages/Menu";
import Settings from "./pages/Settings";
import LoadingOverlay from "./components/LoadingOverlay";
import { type Page } from "./components/sidebar/types";

// import useAppState from "./hooks/useAppState";
import { useAppStateStore } from "./store/appStore.ts";
import useEpisodePanelState from "./hooks/useEpisodePanelState";
import useImportExport from "./hooks/useImportExport";
import useDiscordRPC from "./hooks/useDiscordRPC";
import useHEVCSupport from "./hooks/useHEVCSupport";
import useDragDropImport from "./hooks/useDragDropImport";
import usePersistence from "./hooks/usePersistence";

import { remapPathRoot } from "./utils/episodeUtils";
const EPISODE_PANEL_STORAGE_KEY = "amverge_episode_panel_v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "amverge_sidebar_width_px_v1";
const EXPORT_DIR_STORAGE_KEY = "amverge_export_dir_v1";

function App() {
  // Core app state
  // const {
  //   state,
  //   dispatch,
  //   setFocusedClip,
  //   setSelectedClips,
  //   setClips,
  //   setEpisodes,
  //   setSelectedEpisodeId,
  //   setEpisodeFolders,
  //   setOpenedEpisodeId,
  //   setSelectedFolderId,
  //   setImportedVideoPath,
  //   setVideoIsHEVC,
  // } = useAppState();

  // Refs
  const gridRef = useRef<HTMLDivElement>(null);
  const windowWrapperRef = useRef<HTMLDivElement | null>(null);
  const mainLayoutWrapperRef = useRef<HTMLDivElement | null>(null);
  const userHasHEVC = useRef(false);
  const abortedRef = useRef(false);

  // UI state
  const [gridPreview, setGridPreview] = useState(false);
  const [cols, setCols] = useState(6);
  const [isDragging, setIsDragging] = useState(false);
  const [sideBarEnabled, setSideBarEnabled] = useState(true);
  const [activePage, setActivePage] = useState<Page>("home");
  const generalSettings = useGeneralSettingsStore();
  const themeSettings = useThemeSettingsStore();


  // App states
  const focusedClip = useAppStateStore((s) => s.focusedClip);
  const setFocusedClip = useAppStateStore((s) => s.setFocusedClip);

  const selectedClips = useAppStateStore((s) => s.selectedClips);
  const setSelectedClips = useAppStateStore((s) => s.setSelectedClips);

  const clips = useAppStateStore((s) => s.clips);
  const setClips = useAppStateStore((s) => s.setClips);

  const episodes = useAppStateStore((s) => s.episodes);
  const setEpisodes = useAppStateStore((s) => s.setEpisodes);

  const selectedEpisodeId = useAppStateStore((s) => s.selectedEpisodeId);
  const setSelectedEpisodeId = useAppStateStore((s) => s.setSelectedEpisodeId);

  const episodeFolders = useAppStateStore((s) => s.episodeFolders);
  const setEpisodeFolders = useAppStateStore((s) => s.setEpisodeFolders);

  const openedEpisodeId = useAppStateStore((s) => s.openedEpisodeId);
  const setOpenedEpisodeId = useAppStateStore((s) => s.setOpenedEpisodeId);

  const selectedFolderId = useAppStateStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useAppStateStore((s) => s.setSelectedFolderId);

  const importedVideoPath = useAppStateStore((s) => s.importedVideoPath);
  const setImportedVideoPath = useAppStateStore((s) => s.setImportedVideoPath);

  const videoIsHEVC = useAppStateStore((s) => s.videoIsHEVC);
  const setVideoIsHEVC = useAppStateStore((s) => s.setVideoIsHEVC);

  const resetAppState = useAppStateStore((s) => s.resetAppState);


  useEffect(() => {
    applyThemeSettings(themeSettings);
  }, [themeSettings]);

  // useEffect(() => {
  //   saveGeneralSettings(generalSettings);
  // }, [generalSettings]);

  // const handleResetGeneralSettings = async () => {
  //   try {
  //     const resolvedOldPath = await invoke<string>("move_episodes_to_new_dir", {
  //       oldDir: generalSettings.episodesPath,
  //       newDir: null,
  //     });

  //     const defaultEpisodesPath = await invoke<string>("get_default_episodes_dir");

  //     remapEpisodePaths(resolvedOldPath, defaultEpisodesPath);      
  //     saveGeneralSettings(DEFAULT_GENERAL_SETTINGS);
  //     setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
  //   } catch (err) {
  //     window.alert("Failed to reset episode directory: " + String(err));
  //   }
  // };

  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Starting...");
  const [dividerOffsetPx, setDividerOffsetPx] = useState(0);

  // Persisted UI state
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {}
    return 280;
  });

  const [exportDir, setExportDir] = useState<string | null>(() => {
    try {
      return localStorage.getItem(EXPORT_DIR_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  // Derived values
  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);
  const isEmpty = clips.length === 0;

  // Import/export
  const { updateRPC } = useDiscordRPC(generalSettings, activePage);

  const {
    loading,
    importToken,
    setImportToken,
    batchTotal,
    batchDone,
    batchCurrentFile,
    onImportClick,
    handleImport,
    handleExport,
    handlePickExportDir,
    handleBatchImport,
    handleDownloadSingleClip,
  } = useImportExport({
    setProgress,
    setProgressMsg,
    abortedRef,
    EXPORT_DIR_STORAGE_KEY,
    exportDir,
    setExportDir,
    exportFormat: generalSettings.exportFormat,
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
  } = useEpisodePanelState({
    setImportToken,
  });

  const remapEpisodePaths = (oldRoot: string, newRoot: string) => {
    setEpisodes((prev) => {
      const updatedEpisodes = prev.map((episode) => ({
        ...episode,
        clips: episode.clips.map((clip) => ({
          ...clip,
          src: remapPathRoot(clip.src, oldRoot, newRoot),
          thumbnail: remapPathRoot(clip.thumbnail, oldRoot, newRoot),
        })),
      }));

      return updatedEpisodes;
    });

    setClips((prev) =>
      prev.map((clip) => ({
        ...clip,
        src: remapPathRoot(clip.src, oldRoot, newRoot),
        thumbnail: remapPathRoot(clip.thumbnail, oldRoot, newRoot),
      }))
    );
  };
    
  // App-level hooks
  useHEVCSupport(userHasHEVC);

  usePersistence({
    episodePanelStorageKey: EPISODE_PANEL_STORAGE_KEY,
    sidebarWidthStorageKey: SIDEBAR_WIDTH_STORAGE_KEY,
    exportDirStorageKey: EXPORT_DIR_STORAGE_KEY,
    handleSelectEpisodeFromStorage,
    sidebarWidthPx,
    exportDir,
  });

  useDragDropImport({
    setIsDragging,
    handleImport,
    handleBatchImport,
  });

  // Episode selection
  function handleSelectEpisode(episodeId: string) {
    setSelectedEpisodeId(episodeId)
    setSelectedFolderId(null)

    const episode = episodes.find((e) => e.id === episodeId);
    setClips(episode ? episode.clips : []);
  }

  function handleOpenEpisode(episodeId: string) {
    const episode = episodes.find((e) => e.id === episodeId);
    if (!episode) return;

    setSelectedEpisodeId(episodeId)
    setOpenedEpisodeId(episodeId)
    setSelectedFolderId(null)
    setClips(episode.clips)
  }

  function handleSelectEpisodeFromStorage(
    episodeId: string | null,
    episodesList?: typeof episodes
  ) {
    setSelectedEpisodeId(episodeId ?? null )
    setSelectedFolderId(null)

    if (episodeId && Array.isArray(episodesList)) {
      const episode = episodesList.find((e) => e.id === episodeId);
      setClips(episode ? episode.clips: [])
    } else {
      setClips([])
    }
  }

  // UI handlers
  function snapGridBigger() {
    setCols((c) => Math.max(1, c - 1));
  }

  function snapGridSmaller() {
    setCols((c) => Math.min(12, c + 1));
  }

  function startSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!sideBarEnabled) return;

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
    resetAppState()
    try {
      await invoke("clear_episode_panel_cache", {
        customPath: generalSettings.episodesPath,
      });
    } catch (err) {
      console.error("clear_episode_panel_cache failed:", err);
    }
  }

  async function handleAbort() {
    abortedRef.current = true;

    try {
      await invoke("abort_detect_scenes");
    } catch (err) {
      console.error("abort_detect_scenes failed:", err);
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
  }, [activePage, sideBarEnabled]);

  return (
    <AppLayout
      windowWrapperRef={windowWrapperRef}
      isDragging={isDragging}
      loadingOverlay={
        loading ? (
          <LoadingOverlay
            progress={progress}
            progressMsg={progressMsg}
            batchTotal={batchTotal}
            batchDone={batchDone}
            batchCurrentFile={batchCurrentFile}
            onAbort={handleAbort}
          />
        ) : null
      }
      sidebarProps={{
        sideBarEnabled,
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
      navbarProps={{
        setSideBarEnabled,
        sideBarEnabled,
        userHasHEVC,
        videoIsHEVC: videoIsHEVC,
      }}
      dividerProps={{
        onPointerDown: startSidebarResize,
        dividerOffsetPx,
        sidebarWidthPx,
      }}
    >
      <div className="main-content">
        {activePage === "home" ? (
          <HomePage
            cols={cols}
            gridSize={gridSize}
            snapGridBigger={snapGridBigger}
            snapGridSmaller={snapGridSmaller}
            setGridPreview={setGridPreview}
            gridPreview={gridPreview}
            onImportClick={onImportClick}
            loading={loading}
            mainLayoutWrapperRef={mainLayoutWrapperRef}
            gridRef={gridRef}
            importToken={importToken}
            isEmpty={isEmpty}
            handleExport={handleExport}
            sideBarEnabled={sideBarEnabled}
            userHasHEVC={userHasHEVC}
            exportDir={exportDir}
            onPickExportDir={handlePickExportDir}
            onExportDirChange={(dir: string) => setExportDir(dir || null)}
            defaultMergedName={(clips[0]?.originalName || "episode") + "_merged"}
            onDownloadClip={handleDownloadSingleClip}
            themeSettings={themeSettings}
          />
        ) : activePage === "menu" ? (
          <Menu />
        ) : (
          <Settings
            onEpisodesPathChanged={remapEpisodePaths}
          />
        )}
      </div>
    </AppLayout>
  );
}

export default App;