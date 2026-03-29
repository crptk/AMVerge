import { startTransition, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import Navbar from "./components/Navbar.tsx";
import ImportButtons from "./components/ImportButtons.tsx";
import MainLayout from "./MainLayout";
import Sidebar, { type Page } from "./components/Sidebar.tsx"
import Settings from "./pages/Settings";
import { applyThemeSettings, loadThemeSettings } from "./theme";
import "./App.css";

type ClipItem = {
  id: string;
  src: string;
  thumbnail: string;
  originalName?: string;
};

type EpisodeFolder = {
  id: string;
  name: string;
  parentId: string | null;
  isExpanded: boolean;
};

type EpisodeEntry = {
  id: string;
  displayName: string;
  videoPath: string;
  folderId: string | null;
  importedAt: number;
  clips: ClipItem[];
};

const EPISODE_PANEL_STORAGE_KEY = "amverge_episode_panel_v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "amverge_sidebar_width_px_v1";

function fileNameFromPath(path: string): string {
  const last = path.split(/[/\\]/).pop();
  return last || path;
}

function App() {
  const [focusedClip, setFocusedClip] = useState<string | null>(null);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [importToken, setImportToken] = useState(() => Date.now().toString());
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [importedVideoPath, setImportedVideoPath] = useState<string | null>(null)
  const [videoIsHEVC, setVideoIsHEVC] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [gridPreview, setGridPreview] = useState<true | false>(false);
  const [cols, setCols] = useState(6);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Starting..."); 
  const [isEmpty, setIsEmpty] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [sideBarEnabled, setSideBarEnabled] = useState(true);
  const [activePage, setActivePage] = useState<Page>("home");

  const [episodeFolders, setEpisodeFolders] = useState<EpisodeFolder[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeEntry[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [openedEpisodeId, setOpenedEpisodeId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const windowWrapperRef = useRef<HTMLDivElement | null>(null);
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

  const gridRef = useRef<HTMLDivElement>(null);
  const userHasHEVC = useRef<boolean>(false)
  const lastExternalDropRef = useRef<{ path: string; ts: number } | null>(null);
  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);

  // Detect whether the current WebView can decode HEVC (e.g., HEVC Video Extensions on Windows)
  // This is used as a capability gate: if HEVC is supported, we skip proxy logic and prefer originals
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

      if (import.meta.env.DEV) {
        console.log("[amverge] userHasHEVC:", userHasHEVC.current);
      }
    } catch {
      userHasHEVC.current = false;
    }
  }, []);

  // load saved theme
  useEffect(() => {
    applyThemeSettings(loadThemeSettings());
  }, []);

  // Load Episode Panel state
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
        setSelectedEpisodeId(parsed.selectedEpisodeId ?? null);
      }
    } catch {
      // Ignore corrupt storage
    }
  }, []);

  // Persist Episode Panel state (debounced)
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

  // Persist sidebar width
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthPx));
    } catch {
      // ignore
    }
  }, [sidebarWidthPx]);

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

  const detectScenes = async (videoPath: string, episodeCacheId: string) => {
    // calls backend passing in video file and threshold
    const result = await invoke<string>("detect_scenes", {
      videoPath: videoPath,
      episodeCacheId: episodeCacheId,
    });

    // contains path to all clips along w other metadata
    const scenes = JSON.parse(result);

    // turns to an array of objects
    return scenes.map((s: any) => ({
      id: crypto.randomUUID(),
      src: s.path,
      thumbnail: s.thumbnail,
      originalName: s.original_file
    }));
  };

  const onImportClick = async () => {
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mkv", "mov"]
        }
      ]
    });

    handleImport(file)
  }

  const handleImport = async (file: string | null) => {
    // This opens the file dialog to select a video file
    if (!file) return;

    const episodeId = crypto.randomUUID();

    try {
      setIsEmpty(false);
      setProgress(0);
      setProgressMsg("Starting...");
      setLoading(true);
      setImportedVideoPath(file)
      setVideoIsHEVC(null);
      setImportToken(Date.now().toString());

      const formatted = await detectScenes(file, episodeId);
      const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

      const episodeEntry: EpisodeEntry = {
        id: episodeId,
        displayName: inferredName,
        videoPath: file,
        folderId: selectedFolderId,
        importedAt: Date.now(),
        clips: formatted,
      };

      setEpisodes((prev) => [episodeEntry, ...prev]);
      setSelectedEpisodeId(episodeId);
      setOpenedEpisodeId(episodeId);
      startTransition(() => {
        setClips(formatted);
      });
    } catch (err) {
      console.error("Detection failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEpisode = (episodeId: string) => {
    setSelectedEpisodeId(episodeId);
    setSelectedFolderId(null);
  };

  const handleOpenEpisode = (episodeId: string) => {
    const selectedEpisode = episodes.find((e) => e.id === episodeId);
    if (!selectedEpisode) return;

    setIsEmpty(false);
    setSelectedClips(new Set());
    setFocusedClip(null);
    setSelectedEpisodeId(episodeId);
    setOpenedEpisodeId(episodeId);
    setSelectedFolderId(null);
    setImportedVideoPath(selectedEpisode.videoPath);
    setImportToken(Date.now().toString());

    startTransition(() => {
      setClips(selectedEpisode.clips);
    });
  };

  const handleSelectFolder = (folderId: string | null) => {
    setSelectedFolderId(folderId);
    setSelectedEpisodeId(null);
  };

  const handleMoveEpisodeToFolder = (episodeId: string, folderId: string | null) => {
    setEpisodes((prev) =>
      prev.map((e) => (e.id === episodeId ? { ...e, folderId } : e))
    );
  };

  const handleMoveEpisode = (
    episodeId: string,
    folderId: string | null,
    beforeEpisodeId?: string
  ) => {
    setEpisodes((prev) => {
      const fromIndex = prev.findIndex((e) => e.id === episodeId);
      if (fromIndex === -1) return prev;

      const moving = { ...prev[fromIndex], folderId };
      const remaining = prev.filter((e) => e.id !== episodeId);

      if (!beforeEpisodeId) {
        return [moving, ...remaining];
      }

      const toIndex = remaining.findIndex((e) => e.id === beforeEpisodeId);
      if (toIndex === -1) {
        return [moving, ...remaining];
      }

      return [...remaining.slice(0, toIndex), moving, ...remaining.slice(toIndex)];
    });
  };

  const handleMoveFolder = (folderId: string, parentFolderId: string | null, beforeFolderId?: string) => {
    setEpisodeFolders((prev) => {
      const byId = new Map(prev.map((f) => [f.id, f] as const));
      const moving = byId.get(folderId);
      if (!moving) return prev;

      // Prevent cycles: cannot move a folder into itself or any of its descendants.
      if (parentFolderId) {
        let cursor: string | null = parentFolderId;
        while (cursor) {
          if (cursor === folderId) return prev;
          const nextParent: string | null = byId.get(cursor)?.parentId ?? null;
          cursor = nextParent;
        }
      }

      const updatedMoving: EpisodeFolder = { ...moving, parentId: parentFolderId };
      const remaining = prev.filter((f) => f.id !== folderId);

      const indexOf = (id: string) => remaining.findIndex((f) => f.id === id);

      let insertIndex = -1;
      if (beforeFolderId) {
        insertIndex = indexOf(beforeFolderId);
      }

      if (insertIndex === -1) {
        if (parentFolderId === null) {
          // Insert at the start of root folders.
          insertIndex = remaining.findIndex((f) => (f.parentId ?? null) === null);
          if (insertIndex === -1) insertIndex = 0;
        } else {
          // Insert at the start of the parent's children if present, else right after the parent.
          insertIndex = remaining.findIndex((f) => (f.parentId ?? null) === parentFolderId);
          if (insertIndex === -1) {
            const parentIndex = indexOf(parentFolderId);
            insertIndex = parentIndex === -1 ? 0 : parentIndex + 1;
          }
        }
      }

      return [...remaining.slice(0, insertIndex), updatedMoving, ...remaining.slice(insertIndex)];
    });
  };

  const handleSortEpisodePanel = (direction: "asc" | "desc") => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const mult = direction === "asc" ? 1 : -1;

    const folders = episodeFolders;
    const episodesSnapshot = episodes;

    const foldersByParent = new Map<string | null, EpisodeFolder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? null;
      const list = foldersByParent.get(key) ?? [];
      list.push(folder);
      foldersByParent.set(key, list);
    }

    for (const list of foldersByParent.values()) {
      list.sort((a, b) => mult * collator.compare(a.name, b.name));
    }

    const episodesByFolder = new Map<string | null, EpisodeEntry[]>();
    for (const ep of episodesSnapshot) {
      const key = ep.folderId;
      const list = episodesByFolder.get(key) ?? [];
      list.push(ep);
      episodesByFolder.set(key, list);
    }

    for (const list of episodesByFolder.values()) {
      list.sort((a, b) => mult * collator.compare(a.displayName, b.displayName));
    }

    const sortedFolders: EpisodeFolder[] = [];
    const visit = (folder: EpisodeFolder) => {
      sortedFolders.push(folder);
      const children = foldersByParent.get(folder.id) ?? [];
      for (const child of children) visit(child);
    };

    for (const root of foldersByParent.get(null) ?? []) visit(root);
    setEpisodeFolders(sortedFolders);

    setEpisodes(() => {
      const result: EpisodeEntry[] = [];

      // Root episodes (shown after folders in the UI).
      result.push(...(episodesByFolder.get(null) ?? []));

      // Episodes for every folder in depth-first order.
      for (const folder of sortedFolders) {
        result.push(...(episodesByFolder.get(folder.id) ?? []));
      }

      // Any stray episodes with unknown folderId (shouldn't happen) keep at end.
      for (const [key, list] of episodesByFolder) {
        if (key === null) continue;
        if (sortedFolders.some((f) => f.id === key)) continue;
        result.push(...list);
      }

      return result;
    });
  };

  const handleRenameEpisode = (episodeId: string, newName: string) => {
    const trimmed = (newName ?? "").trim();
    if (!trimmed) return;
    setEpisodes((prev) => prev.map((e) => (e.id === episodeId ? { ...e, displayName: trimmed } : e)));
  };

  const handleRenameFolder = (folderId: string, newName: string) => {
    const trimmed = (newName ?? "").trim();
    if (!trimmed) return;
    setEpisodeFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)));
  };

  const handleDeleteFolder = (folderId: string) => {
    setEpisodeFolders((prev) =>
      prev
        .filter((f) => f.id !== folderId)
        .map((f) => (f.parentId === folderId ? { ...f, parentId: null } : f))
    );
    setEpisodes((prev) => prev.map((e) => (e.folderId === folderId ? { ...e, folderId: null } : e)));
    if (selectedFolderId === folderId) setSelectedFolderId(null);
  };

  const handleDeleteEpisode = async (episodeId: string) => {
    setEpisodes((prev) => prev.filter((e) => e.id !== episodeId));

    if (selectedEpisodeId === episodeId) setSelectedEpisodeId(null);

    if (openedEpisodeId === episodeId) {
      setOpenedEpisodeId(null);
      setSelectedClips(new Set());
      setFocusedClip(null);
      setClips([]);
      setIsEmpty(true);
      setImportedVideoPath(null);
      setVideoIsHEVC(null);
    }

    try {
      await invoke("delete_episode_cache", { episodeCacheId: episodeId });
    } catch (err) {
      console.error("delete_episode_cache failed:", err);
    }
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
    setIsEmpty(true);
    setImportedVideoPath(null);
    setVideoIsHEVC(null);

    try {
      await invoke("clear_episode_panel_cache");
    } catch (err) {
      console.error("clear_episode_panel_cache failed:", err);
    }
  };

  const handleCreateFolder = (name: string, parentFolderId: string | null) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;

    const folder: EpisodeFolder = {
      id: crypto.randomUUID(),
      name: trimmed,
      parentId: parentFolderId,
      isExpanded: true,
    };
    setEpisodeFolders((prev) => [folder, ...prev]);
    setSelectedFolderId(folder.id);
  };

  const handleToggleFolderExpanded = (folderId: string) => {
    setEpisodeFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f))
    );
  };
  
  const handleExport = async(selectedClips: Set<string>, mergeEnabled: boolean) => {
    if (selectedClips.size === 0) return;

    const selected = clips.filter(c => selectedClips.has(c.id));
    if (selected.length === 0) return;

    try {
      setLoading(true);

      const clipArray = selected.map(c => c.src);

      if (mergeEnabled) {
        const episodeName = selected[0]?.originalName || "episode";
        const suffix = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");
        const defaultName = `${episodeName}_merged_${suffix}.mp4`;

        const savePath = await save({
          filters: [
            {
              name: "Video",
              extensions: ["mp4"],
            },
          ],
          defaultPath: defaultName,
        });

        if (!savePath) return;

        await invoke("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: mergeEnabled,
        });
      } else {
        const firstClipPath = selected[0]?.src || "";
        const firstFile = firstClipPath.split(/[/\\]/).pop() || "episode_0000.mp4";
        const firstStem = firstFile.replace(/\.[^/.]+$/, "");
        const defaultBase = firstStem.replace(/_\d{4}$/, "");

        const savePath = await save({
          title: "Choose base name for exported clips",
          filters: [
            {
              name: "Video",
              extensions: ["mp4"],
            },
          ],
          defaultPath: `${defaultBase}_####.mp4`,
        });

        if (!savePath) return;

        await invoke("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: false,
        });
      }
      
      console.log("Export complete");
    } catch (err) {
      console.log("Export failed:", err)
    } finally {
      setLoading(false);
    }
  };

  const snapGridSmaller = () => {
    setCols(c => Math.min(12, c + 1));
  };

  // loading effect
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      const stop = await listen<{ percent: number; message: string }>(
        "scene_progress",
        (event) => {
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

        const file = event.payload.paths?.[0];
        if (!file) return;

        // De-dupe: some platforms/webviews may emit two drops.
        const now = Date.now();
        const last = lastExternalDropRef.current;
        if (last && last.path === file && now - last.ts < 500) return;
        lastExternalDropRef.current = { path: file, ts: now };

        handleImport(file);
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

  return (
    <main className="app-root">
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="loading-text">

            <div>{progressMsg}</div>
            <div>{progress}%</div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
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
              className="sidebar-divider"
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
                />
              </>
            ) : (
              <Settings />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
