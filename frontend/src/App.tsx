import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Event, listen } from "@tauri-apps/api/event";
import { 
  applyThemeSettings, 
  loadThemeSettings, 
  saveThemeSettings, 
  DEFAULT_THEME,
  type ThemeSettings 
} from "./settings/themeSettings";

import {
  loadGeneralSettings,
  saveGeneralSettings,
  DEFAULT_GENERAL_SETTINGS,
  type GeneralSettings,
} from "./settings/generalSettings";

import AppLayout from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import Menu from "./pages/Menu";
import Settings from "./pages/Settings";
import LoadingOverlay from "./components/LoadingOverlay";
import { type Page } from "./components/sidebar/types";

import useAppState from "./hooks/useAppState";
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
  const {
    state,
    dispatch,
    setFocusedClip,
    setSelectedClips,
    setClips,
    setEpisodes,
    setSelectedEpisodeId,
    setEpisodeFolders,
    setOpenedEpisodeId,
    setSelectedFolderId,
    setImportedVideoPath,
    setVideoIsHEVC,
  } = useAppState();

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
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => loadThemeSettings());
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(() => loadGeneralSettings());

  useEffect(() => {
    applyThemeSettings(themeSettings);
    saveThemeSettings(themeSettings);
  }, [themeSettings]);

  useEffect(() => {
    saveGeneralSettings(generalSettings);
  }, [generalSettings]);

  const handleResetGeneralSettings = async () => {
    try {
      const resolvedOldPath = await invoke<string>("move_episodes_to_new_dir", {
        oldDir: generalSettings.episodesPath,
        newDir: null,
      });

      const defaultEpisodesPath = await invoke<string>("get_default_episodes_dir");

      remapEpisodePaths(resolvedOldPath, defaultEpisodesPath);      
      saveGeneralSettings(DEFAULT_GENERAL_SETTINGS);
      setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
    } catch (err) {
      window.alert("Failed to reset episode directory: " + String(err));
    }
  };

  const handleResetTheme = async() => {
    setThemeSettings(DEFAULT_THEME);
  }

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
  const isEmpty = state.clips.length === 0;

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
    clips: state.clips,
    setProgress,
    setProgressMsg,
    setFocusedClip,
    setSelectedClips,
    setVideoIsHEVC,
    setImportedVideoPath,
    setClips,
    setEpisodes,
    setSelectedEpisodeId,
    setOpenedEpisodeId,
    selectedFolderId: state.selectedFolderId,
    abortedRef,
    EXPORT_DIR_STORAGE_KEY,
    exportDir,
    setExportDir,
    episodesPath: generalSettings.episodesPath,
    exportFormat: generalSettings.exportFormat,
    onRPCUpdate: updateRPC,
    generalSettings,
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
    episodes: state.episodes,
    setEpisodes,
    selectedEpisodeId: state.selectedEpisodeId,
    setSelectedEpisodeId,
    episodeFolders: state.episodeFolders,
    setEpisodeFolders,
    openedEpisodeId: state.openedEpisodeId,
    setOpenedEpisodeId,
    selectedFolderId: state.selectedFolderId,
    setSelectedFolderId,
    setClips,
    setSelectedClips,
    setFocusedClip,
    setImportedVideoPath,
    setImportToken,
    episodesPath: generalSettings.episodesPath,
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
    episodeFolders: state.episodeFolders,
    episodes: state.episodes,
    selectedFolderId: state.selectedFolderId,
    selectedEpisodeId: state.selectedEpisodeId,
    setEpisodeFolders,
    setEpisodes,
    setSelectedFolderId,
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
    dispatch({ type: "setSelectedEpisodeId", value: episodeId });
    dispatch({ type: "setSelectedFolderId", value: null });

    const episode = state.episodes.find((e) => e.id === episodeId);
    dispatch({ type: "setClips", value: episode ? episode.clips : [] });
  }

  function handleOpenEpisode(episodeId: string) {
    const episode = state.episodes.find((e) => e.id === episodeId);
    if (!episode) return;

    dispatch({ type: "setSelectedEpisodeId", value: episodeId });
    dispatch({ type: "setOpenedEpisodeId", value: episodeId });
    dispatch({ type: "setSelectedFolderId", value: null });
    dispatch({ type: "setClips", value: episode.clips });
  }

  function handleSelectEpisodeFromStorage(
    episodeId: string | null,
    episodesList?: typeof state.episodes
  ) {
    dispatch({ type: "setSelectedEpisodeId", value: episodeId ?? null });
    dispatch({ type: "setSelectedFolderId", value: null });

    if (episodeId && Array.isArray(episodesList)) {
      const episode = episodesList.find((e) => e.id === episodeId);
      dispatch({ type: "setClips", value: episode ? episode.clips : [] });
    } else {
      dispatch({ type: "setClips", value: [] });
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
    dispatch({ type: "setEpisodeFolders", value: [] });
    dispatch({ type: "setEpisodes", value: [] });
    dispatch({ type: "setSelectedFolderId", value: null });
    dispatch({ type: "setSelectedEpisodeId", value: null });
    dispatch({ type: "setOpenedEpisodeId", value: null });
    dispatch({ type: "setSelectedClips", value: new Set() });
    dispatch({ type: "setFocusedClip", value: null });
    dispatch({ type: "setClips", value: [] });
    dispatch({ type: "setImportedVideoPath", value: null });
    dispatch({ type: "setVideoIsHEVC", value: null });

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
    if (!state.importedVideoPath) {
      dispatch({ type: "setVideoIsHEVC", value: null });
      return;
    }

    let cancelled = false;

    dispatch({ type: "setVideoIsHEVC", value: null });

    (async () => {
      try {
        const hevc = await invoke<boolean>("check_hevc", {
          videoPath: state.importedVideoPath,
        });

        if (!cancelled) {
          dispatch({ type: "setVideoIsHEVC", value: hevc });
        }
      } catch (err) {
        console.error("check_hevc failed:", err);

        if (!cancelled) {
          dispatch({ type: "setVideoIsHEVC", value: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.importedVideoPath, importToken, dispatch]);

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
        episodeFolders: state.episodeFolders,
        episodes: state.episodes,
        selectedEpisodeId: state.selectedEpisodeId,
        openedEpisodeId: state.openedEpisodeId,
        selectedFolderId: state.selectedFolderId,
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
        videoIsHEVC: state.videoIsHEVC,
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
            selectedClips={state.selectedClips}
            setSelectedClips={setSelectedClips}
            onImportClick={onImportClick}
            loading={loading}
            mainLayoutWrapperRef={mainLayoutWrapperRef}
            gridRef={gridRef}
            clips={state.clips}
            importToken={importToken}
            isEmpty={isEmpty}
            handleExport={handleExport}
            sideBarEnabled={sideBarEnabled}
            videoIsHEVC={state.videoIsHEVC}
            userHasHEVC={userHasHEVC}
            focusedClip={state.focusedClip}
            setFocusedClip={setFocusedClip}
            exportDir={exportDir}
            onPickExportDir={handlePickExportDir}
            onExportDirChange={(dir: string) => setExportDir(dir || null)}
            defaultMergedName={(state.clips[0]?.originalName || "episode") + "_merged"}
            openedEpisodeId={state.openedEpisodeId}
            importedVideoPath={state.importedVideoPath}
            generalSettings={generalSettings}
            setGeneralSettings={setGeneralSettings}
            onDownloadClip={handleDownloadSingleClip}
            themeSettings={themeSettings}
          />
        ) : activePage === "menu" ? (
          <Menu />
        ) : (
          <Settings
            themeSettings={themeSettings}
            setThemeSettings={setThemeSettings}
            generalSettings={generalSettings}
            setGeneralSettings={setGeneralSettings}
            onGeneralSettingsReset={handleResetGeneralSettings}
            onEpisodesPathChanged={remapEpisodePaths}
            onThemeReset={handleResetTheme}
          />
        )}
      </div>
    </AppLayout>
  );
}

export default App;