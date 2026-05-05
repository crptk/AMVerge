import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Event, listen } from "@tauri-apps/api/event";
import { DEFAULT_GENERAL_SETTINGS } from "./stores/settingsStore";

import AppLayout from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import Menu from "./pages/Menu";
import Settings from "./pages/Settings";
import LoadingOverlay from "./components/LoadingOverlay";

import useDiscordRPC from "./hooks/useDiscordRPC";
import useHEVCSupport from "./hooks/useHEVCSupport";
import useDragDropImport from "./hooks/useDragDropImport";
import useImportExport from "./hooks/useImportExport";

import { remapPathRoot } from "./utils/episodeUtils";

import { useAppStateStore } from "./stores/appStore";
import { useUIStateStore } from "./stores/UIStore";
import { useGeneralSettingsStore, useThemeSettingsStore } from "./stores/settingsStore";
import { useEpisodePanelRuntimeStore } from "./stores/episodeStore";


function App() {
  const loading = useAppStateStore((s) => s.loading);
  const progress = useAppStateStore((s) => s.progress);
  const progressMsg = useAppStateStore((s) => s.progressMsg);
  const batchTotal = useAppStateStore((s) => s.batchTotal);
  const batchDone = useAppStateStore((s) => s.batchDone);
  const batchCurrentFile = useAppStateStore((s) => s.batchCurrentFile);
  const setProgress = useAppStateStore((s) => s.setProgress);
  const setProgressMsg = useAppStateStore((s) => s.setProgressMsg);
  const setVideoIsHEVC = useAppStateStore((s) => s.setVideoIsHEVC);
  const importedVideoPath = useAppStateStore((s) => s.importedVideoPath);
  const importToken = useAppStateStore((s) => s.importToken);


  // Refs
  const windowWrapperRef = useRef<HTMLDivElement | null>(null);
  const mainLayoutWrapperRef = useRef<HTMLDivElement | null>(null);
  const userHasHEVC = useAppStateStore((s) => s.userHasHEVC);
  const abortedRef = useRef(false);

  // UI state
  const generalSettings = useGeneralSettingsStore();


  const sidebarEnabled = useUIStateStore(s => s.sidebarEnabled);
  const setSidebarEnabled = useUIStateStore(s => s.setSidebarEnabled);
  const activePage = useUIStateStore(s => s.activePage);
  const isDragging = useUIStateStore(s => s.isDragging);

  const timelineEnabled = useMemo(() => {
    try {
      const raw = localStorage.getItem("amverge_timeline_enabled_v1");
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("amverge_timeline_enabled_v1", String(timelineEnabled));
  }, [timelineEnabled]);

  const handleResetGeneralSettings = async () => {
    try {
      const resolvedOldPath = await invoke<string>("move_episodes_to_new_dir", {
        oldDir: generalSettings.episodesPath,
        newDir: null,
      });

      const defaultEpisodesPath = await invoke<string>("get_default_episodes_dir");

      remapEpisodePaths(resolvedOldPath, defaultEpisodesPath);      
      useGeneralSettingsStore.setState(DEFAULT_GENERAL_SETTINGS);
    } catch (err) {
      window.alert("Failed to reset episode directory: " + String(err));
    }
  };

  const handleResetTheme = async() => {
    useThemeSettingsStore.getState().resetThemeSettings();
  }

  const [dividerOffsetPx, setDividerOffsetPx] = useState(0);

  // Persisted UI state
  const sidebarWidthPx = useUIStateStore(s => s.sidebarWidthPx);
  const setSidebarWidthPx = useUIStateStore(s => s.setSidebarWidthPx);

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

  const remapEpisodePaths = (oldRoot: string, newRoot: string) => {
    useEpisodePanelRuntimeStore.setState((s) => ({
      episodes: s.episodes.map((episode) => ({
        ...episode,
        clips: episode.clips.map((clip) => ({
          ...clip,
          src: remapPathRoot(clip.src, oldRoot, newRoot),
          thumbnail: remapPathRoot(clip.thumbnail, oldRoot, newRoot),
        })),
      }))
    }));

    useAppStateStore.setState((s) => ({
      clips: s.clips.map((clip) => ({
        ...clip,
        src: remapPathRoot(clip.src, oldRoot, newRoot),
        thumbnail: remapPathRoot(clip.thumbnail, oldRoot, newRoot),
      }))
    }));
  };

  // Import/export
  const { updateRPC } = useDiscordRPC();

  const { handleImport, handleBatchImport } = useImportExport({
    abortedRef,
    onRPCUpdate: updateRPC
  });

  // App-level hooks
  useHEVCSupport();

  useDragDropImport({
    handleImport,
    handleBatchImport
  });

  async function handleAbort() {
    abortedRef.current = true;

    try {
      await Promise.allSettled([
        invoke("abort_detect_scenes"),
        invoke("abort_export"),
        invoke("abort_editor_import"),
      ]);
    } catch (err) {
      console.error("abort tasks failed:", err);
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
  }, [importedVideoPath, importToken, setVideoIsHEVC]);

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
            batchCurrentFile={batchCurrentFile || ""}
            onAbort={handleAbort}
          />
        ) : null
      }
      sidebarEnabled={sidebarEnabled}
      navbarProps={{
        setSidebarEnabled,
        sidebarEnabled,
        userHasHEVC,
        videoIsHEVC: useAppStateStore(s => s.videoIsHEVC),
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
            mainLayoutWrapperRef={mainLayoutWrapperRef}
            timelineEnabled={timelineEnabled}
          />
        ) : activePage === "menu" ? (
          <Menu />
        ) : (
          <Settings
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
