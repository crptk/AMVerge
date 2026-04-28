import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Event, listen } from "@tauri-apps/api/event";

import AppLayout from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import Menu from "./pages/Menu";
import Settings from "./pages/Settings";
import LoadingOverlay from "./components/LoadingOverlay";
import { type Page } from "./components/sidebar/types";

import useAppState from "./hooks/useAppState";
import useEpisodePanelState from "./hooks/useEpisodePanelState";
import useImportExport from "./hooks/useImportExport";
import useHEVCSupport from "./hooks/useHEVCSupport";
import useDragDropImport from "./hooks/useDragDropImport";
import usePersistence from "./hooks/usePersistence";
import type { DerushCategory, DerushSnapshot, EpisodeEntry } from "./types/domain";

const EPISODE_PANEL_STORAGE_KEY = "amverge_episode_panel_v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "amverge_sidebar_width_px_v1";
const EXPORT_DIR_STORAGE_KEY = "amverge_export_dir_v1";
const DERUSH_CATEGORY_COLORS = [
  "#8DF7B1",
  "#86E3FF",
  "#FFD38A",
  "#F8A8A8",
  "#A6B7FF",
  "#C6FF9C",
];

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
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Starting...");
  const [dividerOffsetPx, setDividerOffsetPx] = useState(0);

  // Persisted UI state
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore
    }

    return 280;
  });

  const [exportDir, setExportDir] = useState<string | null>(() => {
    try {
      return localStorage.getItem(EXPORT_DIR_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  // Derush workflow state (SQLite-backed)
  const [derushScope, setDerushScope] = useState<"episode" | "folder">("episode");
  const [derushProject, setDerushProject] = useState<{
    id: string;
    sourceName: string;
    sourceKey: string;
  } | null>(null);
  const [derushCategories, setDerushCategories] = useState<DerushCategory[]>([]);
  const [derushActiveCategoryId, setDerushActiveCategoryId] = useState<string>("all");
  const [clipCategoryMap, setClipCategoryMap] = useState<Record<string, string[]>>({});
  const [derushSyncing, setDerushSyncing] = useState(false);

  // Derived values
  const currentEpisode = useMemo(() => {
    const currentEpisodeId = state.openedEpisodeId ?? state.selectedEpisodeId;
    if (!currentEpisodeId) return null;
    return state.episodes.find((episode) => episode.id === currentEpisodeId) ?? null;
  }, [state.openedEpisodeId, state.selectedEpisodeId, state.episodes]);

  const currentEpisodeClipSignature = useMemo(() => {
    if (!currentEpisode) return "";
    return currentEpisode.clips.map((clip) => clip.id).join("|");
  }, [currentEpisode]);

  const episodeFolderMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of state.episodeFolders) {
      map.set(folder.id, folder.name);
    }
    return map;
  }, [state.episodeFolders]);

  const currentEpisodeFolderName =
    currentEpisode?.folderId ? episodeFolderMap.get(currentEpisode.folderId) ?? null : null;
  const canUseFolderScope = Boolean(currentEpisode?.folderId);

  useEffect(() => {
    if (!canUseFolderScope && derushScope === "folder") {
      setDerushScope("episode");
    }
  }, [canUseFolderScope, derushScope]);

  const previousEpisodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextEpisodeId = currentEpisode?.id ?? null;
    if (!nextEpisodeId) {
      previousEpisodeIdRef.current = null;
      return;
    }

    if (previousEpisodeIdRef.current !== nextEpisodeId) {
      setDerushScope(currentEpisode?.folderId ? "folder" : "episode");
      previousEpisodeIdRef.current = nextEpisodeId;
    }
  }, [currentEpisode?.id, currentEpisode?.folderId]);

  const filteredClips = useMemo(() => {
    if (derushActiveCategoryId === "all") return state.clips;

    return state.clips.filter((clip) =>
      (clipCategoryMap[clip.id] ?? []).includes(derushActiveCategoryId)
    );
  }, [state.clips, clipCategoryMap, derushActiveCategoryId]);

  const categoryColorMap = useMemo(() => {
    return derushCategories.reduce<Record<string, string>>((acc, category) => {
      acc[category.id] = category.color;
      return acc;
    }, {});
  }, [derushCategories]);

  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);
  const isEmpty = filteredClips.length === 0;

  // Import/export
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
  });

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

  const refreshDerushSnapshot = useCallback(
    async (episode: EpisodeEntry | null) => {
      if (!episode) {
        setDerushProject(null);
        setDerushCategories([]);
        setClipCategoryMap({});
        setDerushActiveCategoryId("all");
        return;
      }

      const scopeIsFolder = derushScope === "folder" && Boolean(episode.folderId);
      const scopeKey = scopeIsFolder ? `folder_${episode.folderId}` : `episode_${episode.id}`;
      const scopeName = scopeIsFolder
        ? (episodeFolderMap.get(episode.folderId as string) ?? episode.displayName)
        : episode.displayName;

      setDerushSyncing(true);
      try {
        const snapshot = await invoke<DerushSnapshot>("sync_derush_episode", {
          episodeId: episode.id,
          episodeDisplayName: episode.displayName,
          videoPath: episode.videoPath,
          scopeKey,
          scopeName,
          clips: episode.clips.map((clip) => ({
            id: clip.id,
            src: clip.src,
            thumbnail: clip.thumbnail,
            originalName: clip.originalName,
          })),
        });

        setDerushProject(snapshot.project);
        setDerushCategories(snapshot.categories ?? []);
        setClipCategoryMap(snapshot.clipCategoryMap ?? {});
        setDerushActiveCategoryId((prev) => {
          if (prev === "all") return "all";
          const exists = (snapshot.categories ?? []).some((category) => category.id === prev);
          return exists ? prev : "all";
        });
      } catch (err) {
        console.error("sync_derush_episode failed:", err);
      } finally {
        setDerushSyncing(false);
      }
    },
    [derushScope, episodeFolderMap]
  );

  const handleCreateDerushCategory = useCallback(
    async (name: string, color: string) => {
      const trimmed = name.trim();
      if (!trimmed || !derushProject || !currentEpisode) return;

      const pickedColor =
        color && color.trim()
          ? color
          : DERUSH_CATEGORY_COLORS[derushCategories.length % DERUSH_CATEGORY_COLORS.length];

      try {
        await invoke<DerushCategory>("create_derush_category", {
          projectId: derushProject.id,
          name: trimmed,
          color: pickedColor,
          icon: trimmed.charAt(0).toUpperCase(),
        });
        await refreshDerushSnapshot(currentEpisode);
      } catch (err) {
        console.error("create_derush_category failed:", err);
      }
    },
    [derushProject, currentEpisode, derushCategories.length, refreshDerushSnapshot]
  );

  const handleUpdateDerushCategory = useCallback(
    async (categoryId: string, name: string, color: string) => {
      const trimmed = name.trim();
      if (!categoryId || !trimmed || !currentEpisode) return;

      try {
        await invoke("update_derush_category", {
          categoryId,
          name: trimmed,
          color,
        });
        await refreshDerushSnapshot(currentEpisode);
      } catch (err) {
        console.error("update_derush_category failed:", err);
      }
    },
    [currentEpisode, refreshDerushSnapshot]
  );

  const handleDeleteDerushCategory = useCallback(
    async (categoryId: string) => {
      if (!categoryId || !currentEpisode) return;

      if (derushActiveCategoryId === categoryId) {
        setDerushActiveCategoryId("all");
      }

      try {
        await invoke("delete_derush_category", { categoryId });
        await refreshDerushSnapshot(currentEpisode);
      } catch (err) {
        console.error("delete_derush_category failed:", err);
      }
    },
    [currentEpisode, derushActiveCategoryId, refreshDerushSnapshot]
  );

  const handleToggleClipCategory = useCallback(
    async (clipId: string, categoryId: string) => {
      if (!currentEpisode || categoryId === "all") return;

      const wasAssigned = (clipCategoryMap[clipId] ?? []).includes(categoryId);
      const nextEnabled = !wasAssigned;

      setClipCategoryMap((prev) => {
        const current = prev[clipId] ?? [];
        const has = current.includes(categoryId);
        const next = has
          ? current.filter((id) => id !== categoryId)
          : [...current, categoryId];
        return { ...prev, [clipId]: next };
      });

      try {
        await invoke("set_derush_clip_category", {
          clipId,
          categoryId,
          enabled: nextEnabled,
        });
      } catch (err) {
        console.error("set_derush_clip_category failed:", err);
        await refreshDerushSnapshot(currentEpisode);
      }
    },
    [clipCategoryMap, currentEpisode, refreshDerushSnapshot, setClipCategoryMap]
  );

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
    setDerushProject(null);
    setDerushCategories([]);
    setClipCategoryMap({});
    setDerushActiveCategoryId("all");
    setDerushScope("episode");

    try {
      await invoke("clear_episode_panel_cache");
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

  useEffect(() => {
    void refreshDerushSnapshot(currentEpisode);
  }, [
    currentEpisode?.id,
    currentEpisode?.folderId,
    currentEpisodeClipSignature,
    currentEpisodeFolderName,
    derushScope,
    refreshDerushSnapshot,
  ]);

  useEffect(() => {
    const visibleIds = new Set(filteredClips.map((clip) => clip.id));
    let changed = false;
    const next = new Set<string>();

    for (const clipId of state.selectedClips) {
      if (visibleIds.has(clipId)) {
        next.add(clipId);
      } else {
        changed = true;
      }
    }

    if (changed) {
      setSelectedClips(next);
    }
  }, [filteredClips, state.selectedClips, setSelectedClips]);

  useEffect(() => {
    if (!state.focusedClip) return;
    const stillVisible = filteredClips.some((clip) => clip.src === state.focusedClip);
    if (!stillVisible) {
      setFocusedClip(null);
    }
  }, [filteredClips, state.focusedClip, setFocusedClip]);

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
            clips={filteredClips}
            allClips={state.clips}
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
            derushScope={derushScope}
            canUseFolderScope={canUseFolderScope}
            onDerushScopeChange={setDerushScope}
            derushCategories={derushCategories}
            derushActiveCategoryId={derushActiveCategoryId}
            setDerushActiveCategoryId={setDerushActiveCategoryId}
            clipCategoryMap={clipCategoryMap}
            onCreateDerushCategory={handleCreateDerushCategory}
            onUpdateDerushCategory={handleUpdateDerushCategory}
            onDeleteDerushCategory={handleDeleteDerushCategory}
            onToggleClipCategory={handleToggleClipCategory}
            derushSyncing={derushSyncing}
            categoryColorMap={categoryColorMap}
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
