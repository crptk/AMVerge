/**
 * ClipsContainer.tsx
 *
 * Main grid container for displaying video clips. Handles layout, selection logic, and passes props to each tile (LazyClip).
 * Optimized for performance with lazy loading, proxying, and staggered mounting.
 */
import { startTransition, useCallback, useEffect, useRef } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { LazyClip } from "./LazyClip.tsx"
import { useStaggeredMountQueue } from "./staggeredMountQueue.ts";
import useViewportAwareProxyQueue from "./proxyQueue.ts";
import { useAppStateStore } from "../../stores/appStore.ts";
import { useUIStateStore } from "../../stores/UIStore.ts";
import { useGeneralSettingsStore } from "../../stores/settingsStore.ts";

export default function ClipsContainer({ cols }: { cols?: number }) {
  const clips = useAppStateStore((state) => state.clips);
  const loading = useAppStateStore((state) => state.loading);
  const importToken = useAppStateStore((state) => state.importToken);
  const setFocusedClip = useAppStateStore((state) => state.setFocusedClip);
  const setSelectedClips = useAppStateStore((state) => state.setSelectedClips);
  const setLoading = useAppStateStore((state) => state.setLoading);

  const defaultCols = useUIStateStore((state) => state.cols);
  const generalSettings = useGeneralSettingsStore();

  const activeCols = cols ?? defaultCols;

  // Proxy queue: manages HEVC/H.264 proxy generation and prioritization
  const { requestProxySequential, reportProxyDemand } = useViewportAwareProxyQueue();
  // Staggered mount queue: mounts videos one at a time in grid preview
  const { reportStaggerDemand } = useStaggeredMountQueue();

  // Calculate number of columns for the grid
  const gridColumns = loading
    ? activeCols
    : Math.max(1, Math.min(activeCols, clips.length));

  const clipMaxWidth = gridColumns <= 1
    ? "min(100%, 920px)"
    : gridColumns === 2
      ? "520px"
      : "260px";

  const handleDownloadSingleClip = useCallback(async (clip: (typeof clips)[number]) => {
    try {
      const activeProfile = generalSettings.exportProfiles.find(
        (candidate) => candidate.id === generalSettings.activeExportProfileId
      ) ?? generalSettings.exportProfiles[0];
      const format = activeProfile?.container || generalSettings.exportFormat || "mp4";
      const fileName = clip.originalName || clip.src.split(/[\\/]/).pop() || "clip";
      const defaultPath = `${fileName}.${format}`;

      const savePath = await save({
        defaultPath,
        filters: [{ name: "Video", extensions: [format] }],
      });

      if (!savePath) return;

      setLoading(true);

      const srcs = clip.mergedSrcs ?? [clip.src];
      const exportOptions = {
        profileId: activeProfile.id,
        workflow: activeProfile.workflow,
        editorTarget: activeProfile.editorTarget,
        codec: activeProfile.codec,
        audioMode:
          activeProfile.container === "mov" && activeProfile.audioMode === "flac"
            ? "alac"
            : activeProfile.audioMode === "none"
              ? "copy"
              : activeProfile.audioMode,
        hardwareMode: activeProfile.hardwareMode,
        parallelExports: activeProfile.parallelExports,
      };

      const exportedFiles = await invoke<string[]>("export_clips", {
        clips: srcs,
        savePath,
        mergeEnabled: srcs.length > 1,
        exportOptions,
      });

      if (generalSettings.openFileLocationAfterExport && exportedFiles.length > 0) {
        await invoke("reveal_in_file_manager", { filePath: exportedFiles[0] });
      }
    } catch (err) {
      console.error("Single clip download failed:", err);
    } finally {
      setLoading(false);
    }
  }, [generalSettings, setLoading]);

  const handleClipClick = useCallback(
    (clipId: string, clipSrc: string, index: number, e: React.MouseEvent<HTMLDivElement>) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      const state = useAppStateStore.getState();

      // Shift-click: select a range of clips
      if (isShift) {
        const anchorIndex = state.focusedClip
          ? clips.findIndex((c) => c.src === state.focusedClip)
          : -1;
        const startIndex = anchorIndex !== -1 ? anchorIndex : index;
        const [start, end] = [startIndex, index].sort((a, b) => a - b);
        const rangeIds = clips.slice(start, end + 1).map((c) => c.id);

        startTransition(() => {
          setSelectedClips(new Set(rangeIds));
        });
        return;
      }

      // Ctrl/Cmd-click: toggle selection state for this clip
      if (isCtrlOrCmd) {
        startTransition(() => {
          setSelectedClips((prev) => {
            const next = new Set(prev);
            next.has(clipId) ? next.delete(clipId) : next.add(clipId);
            return next;
          });
        });
        return;
      }

      // Single click: focus this clip for preview without toggling selection
      setFocusedClip(clipSrc);
    },
    [clips, setFocusedClip, setSelectedClips]
  );

  const handleToggleSelection = useCallback(
    (clipId: string, e: React.MouseEvent) => {
      e.stopPropagation(); // Don't trigger focus click
      startTransition(() => {
        setSelectedClips((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [setSelectedClips]
  );

  // Handles double-click on a clip tile (toggle export selection — checkmark only)
  const handleClipDoubleClick = useCallback(
    (clipId: string, _clipSrc: string, _index: number, _e: React.MouseEvent<HTMLDivElement>) => {
      startTransition(() => {
        setSelectedClips((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [setSelectedClips]
  );


  // Ref for the main container (for scroll-to-top on import)
  const containerRef = useRef<HTMLElement>(null);

  // Preserve scroll position across loading-state toggles that don't come from
  // an import (e.g. exporting). When importToken changes we still want the
  // scroll-to-top behaviour below.
  const savedScrollRef = useRef<number | null>(null);
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      prevLoadingRef.current = loading;
      return;
    }
    if (loading && !prevLoadingRef.current) {
      // Loading just started — remember where we were so we can restore.
      savedScrollRef.current = el.scrollTop;
    } else if (!loading && prevLoadingRef.current && savedScrollRef.current !== null) {
      // Loading finished — restore scroll after the grid re-renders.
      const target = savedScrollRef.current;
      savedScrollRef.current = null;
      requestAnimationFrame(() => {
        containerRef.current?.scrollTo({ top: target });
      });
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    // New import - discard any pending scroll restore and go to the top.
    savedScrollRef.current = null;
    containerRef.current?.scrollTo({ top: 0 });
  }, [importToken]);

  // Ctrl + wheel to adjust the grid column count
  const setStoreCols = useUIStateStore((state) => state.setCols);
  const colsOverridden = cols !== undefined;
  const wheelAccumRef = useRef(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || colsOverridden) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      wheelAccumRef.current += e.deltaY;
      const threshold = 40;
      if (Math.abs(wheelAccumRef.current) < threshold) return;

      const direction = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;

      setStoreCols((prev) => {
        const next = prev + direction;
        return Math.max(1, Math.min(12, next));
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [colsOverridden, setStoreCols]);

  return (
    <main className="clips-container" ref={containerRef}>
      {clips.length === 0 ? (
        <p id="empty-grid">No video loaded.</p>
      ) : (
        <div
          className="clips-grid"
          style={{
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            ["--clip-max-width" as any]: clipMaxWidth,
          }}
        >
          {loading
            ? Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="clip-skeleton" />
              ))
            : clips.map((clip, index) => (
                <LazyClip
                  key={clip.id}
                  clip={clip}
                  index={index}
                  requestProxySequential={requestProxySequential}
                  reportProxyDemand={reportProxyDemand}
                  reportStaggerDemand={reportStaggerDemand}
                  onClipClick={handleClipClick}
                  onClipDoubleClick={handleClipDoubleClick}
                  onToggleSelection={handleToggleSelection}
                  onDownloadClip={handleDownloadSingleClip}
                />
              ))}
        </div>
      )}
    </main>
  );
}
