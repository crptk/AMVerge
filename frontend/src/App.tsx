import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Event } from "@tauri-apps/api/event";

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { fileNameFromPath } from "./utils/episodeUtils.ts";
import { applyThemeSettings, loadThemeSettings } from "./theme";
import Navbar from "./components/Navbar.tsx";
import ImportButtons from "./components/ImportButtons.tsx";
import MainLayout from "./MainLayout";
import Sidebar, { type Page } from "./components/Sidebar.tsx"
import Menu from "./pages/Menu.tsx";
import { useEpisodePanelState } from "./hooks/useEpisodePanelState.ts";
import { useImportExport } from "./hooks/useImportExport.ts";

import { ClipItem, EpisodeFolder, EpisodeEntry } from "./types";
import LoadingOverlay from "./components/LoadingOverlay.tsx"
import "./App.css";

const EPISODE_PANEL_STORAGE_KEY = "amverge_episode_panel_v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "amverge_sidebar_width_px_v1";
const EXPORT_DIR_STORAGE_KEY = "amverge_export_dir_v1";

function App() {
  const [focusedClip, setFocusedClip] = useState<string | null>(null);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [clips, setClips] = useState<ClipItem[]>([]);

	const [episodes, setEpisodes] = useState<EpisodeEntry[]>([]);
	const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
	const [episodeFolders, setEpisodeFolders] = useState<EpisodeFolder[]>([]);
	const [openedEpisodeId, setOpenedEpisodeId] = useState<string | null>(null);
	const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const [importedVideoPath, setImportedVideoPath] = useState<string | null>(null)
  const [videoIsHEVC, setVideoIsHEVC] = useState<boolean | null>(null);
  
  const gridRef = useRef<HTMLDivElement>(null);  
  const [gridPreview, setGridPreview] = useState<true | false>(false);
  const [cols, setCols] = useState(6);
  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);

  const isEmpty = clips.length === 0;
  const [isDragging, setIsDragging] = useState(false);
  const [sideBarEnabled, setSideBarEnabled] = useState(true);
  const [activePage, setActivePage] = useState<Page>("home");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Starting...");
  
  const windowWrapperRef = useRef<HTMLDivElement | null>(null);
  const mainLayoutWrapperRef = useRef<HTMLDivElement | null>(null);
  const [dividerOffsetPx, setDividerOffsetPx] = useState(0);
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

  const userHasHEVC = useRef<boolean>(false)
  const lastExternalDropRef = useRef<{ path: string; ts: number } | null>(null);
  const abortedRef = useRef(false);

  const [exportDir, setExportDir] = useState<string | null>(() => {
    try {
      return localStorage.getItem(EXPORT_DIR_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  
  // Centralized episode selection logic
  const handleSelectEpisode = (episodeId: string) => {
    setSelectedEpisodeId(episodeId);
    setSelectedFolderId(null);
    const episode = episodes.find(e => e.id === episodeId);
    setClips(episode ? episode.clips : []);
  };

  const handleOpenEpisode = (episodeId: string) => {
    const episode = episodes.find(e => e.id === episodeId);
    if (!episode) return;
    setSelectedEpisodeId(episodeId);
    setOpenedEpisodeId(episodeId);
    setSelectedFolderId(null);
    setClips(episode.clips);
  };

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
    handleBatchImport
  } = useImportExport({
    clips,
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
    selectedFolderId,
    abortedRef,
    EXPORT_DIR_STORAGE_KEY,
    exportDir,
    setExportDir,
  });

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
    episodes,
    setEpisodes,
    selectedEpisodeId,
    setSelectedEpisodeId,
    episodeFolders,
    setEpisodeFolders,
    openedEpisodeId,
    setOpenedEpisodeId,
    selectedFolderId,
    setSelectedFolderId,
    setClips,
    setSelectedClips,
    setFocusedClip,
    setImportedVideoPath,
    setImportToken
  });

  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sideBarEnabled) return;
    const wrapper = windowWrapperRef.current;
    if (!wrapper) return;

    e.preventDefault();
    e.stopPropagation();

    const pointerId = e.pointerId;
    (e.currentTarget as HTMLDivElement).setPointerCapture(pointerId);
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
  };

  const snapGridBigger = () => {
    setCols(c => Math.max(1, c - 1));
  };

  const handleClearEpisodePanelCache = async () => {
    setEpisodeFolders([]);
    setEpisodes([]);
    setSelectedFolderId(null);
    setSelectedEpisodeId(null);
    setOpenedEpisodeId(null);
    setSelectedClips(new Set());
    setFocusedClip(null);
    setClips([]);
    setImportedVideoPath(null);
    setVideoIsHEVC(null);
    
    try {
      await invoke("clear_episode_panel_cache");
    } catch (err) {
      console.error("clear_episode_panel_cache failed:", err);
    }
  };

  const snapGridSmaller = () => {
    setCols(c => Math.min(12, c + 1));
  };

  const handleAbort = async () => {
      abortedRef.current = true;
      try {
      await invoke("abort_detect_scenes");
      } catch (err) {
      console.error("abort_detect_scenes failed:", err);
      }
  };
  
  // Detect whether the current WebView can decode HEVC (H.265) video files.
  // If HEVC is supported, the app will play original HEVC videos directly.
  // If not, the app will use lower-quality proxy videos instead of the originals.
  useEffect(() => {
    try {
      const candidates = [
        'video/mp4; codecs="hvc1"',
        'video/mp4; codecs="hev1"',
        'video/mp4; codecs="hvc1.1.6.L93.B0"',
        'video/mp4; codecs="hev1.1.6.L93.B0"',
      ];

      const mediaSourceSupported = typeof (window as any).MediaSource !== "undefined";
      const isTypeSupported = mediaSourceSupported
        ? (mime: string) => (window as any).MediaSource.isTypeSupported(mime)
        : (_mime: string) => false;

      const videoEl = document.createElement("video");
      const canPlay = (mime: string) => {
        const result = videoEl.canPlayType(mime);
        return result === "probably" || result === "maybe";
      };

      userHasHEVC.current = candidates.some((c) => isTypeSupported(c) || canPlay(c));
    } catch {
      userHasHEVC.current = false;
    }
  }, []);

  // load saved theme
  useEffect(() => {
    applyThemeSettings(loadThemeSettings());
  }, []);

  // load Episode Panel state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EPISODE_PANEL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        episodeFolders?: EpisodeFolder[];
        episodes?: EpisodeEntry[];
        selectedFolderId?: string | null;
        selectedEpisodeId?: string | null;
      };

      if (Array.isArray(parsed.episodeFolders)) {
        setEpisodeFolders(
          parsed.episodeFolders
            .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
            .map((f) => ({
              id: f.id,
              name: f.name,
              isExpanded: Boolean((f as any).isExpanded),
              parentId: typeof (f as any).parentId === "string" ? (f as any).parentId : null,
            }))
        );
      }
      if (Array.isArray(parsed.episodes)) setEpisodes(parsed.episodes);
      if (typeof parsed.selectedFolderId === "string" || parsed.selectedFolderId === null) {
        setSelectedFolderId(parsed.selectedFolderId ?? null);
      }
      if (typeof parsed.selectedEpisodeId === "string" || parsed.selectedEpisodeId === null) {
        // Use the episode panel abstraction to select the episode, which will update all relevant state
        // (including clips, if you wire it up)
        handleSelectEpisodeFromStorage(parsed.selectedEpisodeId, parsed.episodes);
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  // Helper to select episode and set clips when restoring from storage
  function handleSelectEpisodeFromStorage(episodeId: string | null, episodesList?: EpisodeEntry[]) {
    setSelectedEpisodeId(episodeId ?? null);
    setSelectedFolderId(null);
    if (episodeId && Array.isArray(episodesList)) {
      const episode = episodesList.find(e => e.id === episodeId);
      setClips(episode ? episode.clips : []);
    } else {
      setClips([]);
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const stop = await listen<{ percent: number; message: string }>("scene_progress", (event: Event<{ percent: number; message: string }>) => {
        setProgress(event.payload.percent);
        setProgressMsg(event.payload.message);
      });
      unlisten = stop;
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // persist Episode Panel state
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(
          EPISODE_PANEL_STORAGE_KEY,
          JSON.stringify({
            episodeFolders,
            episodes,
            selectedFolderId,
            selectedEpisodeId,
          })
        );
      } catch {
        // Ignore quota / serialization issues
      }
    }, 150);

    return () => window.clearTimeout(handle);
  }, [episodeFolders, episodes, selectedEpisodeId, selectedFolderId]);

  // persist sidebar width
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthPx));
    } catch {
      // ignore
    }
  }, [sidebarWidthPx]);

  // persist export directory
  useEffect(() => {
    try {
      if (exportDir) {
        localStorage.setItem(EXPORT_DIR_STORAGE_KEY, exportDir);
      } else {
        localStorage.removeItem(EXPORT_DIR_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [exportDir]);

  // drag & drop files effect
  useEffect(() => {
    // IMPORTANT: this is async registration. In React StrictMode/dev, effects can mount/unmount
    // rapidly and cleanup may run before the awaited unlisten is assigned. We guard against that
    // to avoid multiple listeners (which would duplicate imports on drop).
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      const type = event.payload.type;

      if (type === "over") {
        // Only show the overlay for true external file drags.
        const paths = (event.payload as { paths?: string[] }).paths;
        const hasPaths = Array.isArray(paths) && paths.length > 0;
        setIsDragging(hasPaths);
        return;
      }

      if (type === "drop") {
        setIsDragging(false);

        const paths = event.payload.paths;
        if (!paths || paths.length === 0) return;

        // De-dupe: some platforms/webviews may emit two drops.
        const now = Date.now();
        const last = lastExternalDropRef.current;
        if (last && last.path === paths[0] && now - last.ts < 500) return;
        lastExternalDropRef.current = { path: paths[0], ts: now };

        // Filter to supported video extensions
        const videoExtensions = ["mp4", "mkv", "mov"];
        const videoFiles = paths.filter((p: string) => {
          const ext = p.split(".").pop()?.toLowerCase() || "";
          return videoExtensions.includes(ext);
        });

        if (videoFiles.length === 0) return;

        if (videoFiles.length === 1) {
          handleImport(videoFiles[0]);
        } else {
          handleBatchImport(videoFiles);
        }
        return;
      }

      setIsDragging(false);
    });

    void unlistenPromise.then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      disposed = true;
      setIsDragging(false);

      if (unlisten) {
        unlisten();
        return;
      }

      void unlistenPromise.then((stop) => stop());
    };
  }, []);

  // checking if video is hevc useEffect
  useEffect(() => {
    if (!importedVideoPath) {
      setVideoIsHEVC(null);
      return;
    }

    let cancelled = false;

    // Mark as "checking" for this import so hover previews can avoid black-screen attempts
    setVideoIsHEVC(null);

    (async () => {
      try {
        const hevc = await invoke<boolean>("check_hevc", {
          videoPath: importedVideoPath
        });

        if (!cancelled) setVideoIsHEVC(hevc)
      } catch (err) {
        console.error("check_hevc failed:", err)
        if (!cancelled) setVideoIsHEVC(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importedVideoPath, importToken])

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

      setDividerOffsetPx((prev) => (Math.abs(prev - offsetPx) < 0.5 ? prev : offsetPx));
    };

    update();

    const ro = new ResizeObserver(() => update());
    if (mainLayoutWrapperRef.current) ro.observe(mainLayoutWrapperRef.current);
    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activePage, sideBarEnabled]);

  return (
    <main className="app-root">
      {loading && (
        <LoadingOverlay
          progress={progress}
          progressMsg={progressMsg}
          batchTotal={batchTotal}
          batchDone={batchDone}
          batchCurrentFile={batchCurrentFile}
          onAbort={handleAbort}
        />
      )}

      {isDragging && (
        <div className="dragging-overlay">
          <h1>Drag file(s) here.</h1>
        </div>

      )}
      <div
        className="window-wrapper"
        ref={windowWrapperRef}
        style={{
          ["--amverge-sidebar-width" as any]: `${sidebarWidthPx}px`,
          ["--amverge-divider-offset" as any]: `${dividerOffsetPx}px`,
        }}
      >
        {sideBarEnabled && (
          <>
            <Sidebar
              activePage={activePage}
              setActivePage={setActivePage}
              episodeFolders={episodeFolders}
              episodes={episodes}
              selectedEpisodeId={selectedEpisodeId}
              openedEpisodeId={openedEpisodeId}
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleSelectFolder}
              onToggleFolderExpanded={handleToggleFolderExpanded}
              onCreateFolder={handleCreateFolder}
              onSelectEpisode={handleSelectEpisode}
              onOpenEpisode={handleOpenEpisode}
              onDeleteEpisode={handleDeleteEpisode}
              onRenameEpisode={handleRenameEpisode}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveEpisodeToFolder={handleMoveEpisodeToFolder}
              onMoveEpisode={handleMoveEpisode}
              onMoveFolder={handleMoveFolder}
              onSortEpisodePanel={handleSortEpisodePanel}
              onClearEpisodePanelCache={handleClearEpisodePanelCache}
            />
            <div
              className="divider sidebar-splitter"
              onPointerDown={startSidebarResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              tabIndex={-1}
            >
              <span className="subdivider" />
              <span className="subdivider" />
            </div>
          </>
        )}
        <div className="content-wrapper">
          <Navbar 
           setSideBarEnabled={setSideBarEnabled}
           sideBarEnabled={sideBarEnabled}
           userHasHEVC={userHasHEVC}
           videoIsHEVC={videoIsHEVC}/>
          <div className="main-content">
            {activePage === "home" ? (
              <>
                <ImportButtons 
                  cols={cols}
                  gridSize={gridSize}
                  onBigger={snapGridBigger}
                  onSmaller={snapGridSmaller}
                  setGridPreview={setGridPreview}
                  gridPreview={gridPreview}
                  selectedClips={selectedClips}
                  setSelectedClips={setSelectedClips}
                  onImport={onImportClick}
                  loading={loading}
                />
                <div className="main-layout-wrapper" ref={mainLayoutWrapperRef}>
                  <MainLayout 
                    cols={cols}
                    gridSize={gridSize}
                    gridRef={gridRef}
                    gridPreview={gridPreview}
                    selectedClips={selectedClips}
                    setSelectedClips={setSelectedClips}
                    clips={clips}
                    importToken={importToken}
                    loading={loading}
                    isEmpty={isEmpty}
                    handleExport={handleExport}
                    sideBarEnabled={sideBarEnabled}
                    videoIsHEVC={videoIsHEVC}
                    userHasHEVC={userHasHEVC}
                    focusedClip={focusedClip}
                    setFocusedClip={setFocusedClip}
                    exportDir={exportDir}
                    onPickExportDir={handlePickExportDir}
                    onExportDirChange={(dir: string) => setExportDir(dir || null)}
                    defaultMergedName={
                      (clips[0]?.originalName || "episode") + "_merged"
                    }
                  />
                  <div className="info-bar">
                    {openedEpisodeId && importedVideoPath && (
                      <span className="info-bar-filename">{fileNameFromPath(importedVideoPath)}</span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <Menu />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
