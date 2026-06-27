/**
 * ClipsContainer.tsx
 *
 * Main grid container for displaying video clips. Handles layout, selection logic, and passes props to each tile (LazyClip).
 * Optimized for performance with lazy loading, proxying, and staggered mounting.
 */
import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { LazyClip } from "./LazyClip.tsx"
import { useGridVirtualizer } from "./useGridVirtualizer.ts";
import { useStaggeredMountQueue } from "./staggeredMountQueue.ts";
import useViewportAwareProxyQueue from "./proxyQueue.ts";
import useViewportAwareWebpQueue from "./webpQueue.ts";
import { useAppStateStore } from "../../stores/appStore.ts";
import { useUIStateStore } from "../../stores/UIStore.ts";
import { useGeneralSettingsStore } from "../../stores/settingsStore.ts";
import { useEpisodePanelRuntimeStore } from "../../stores/episodeStore.ts";

export default function ClipsContainer({ cols }: { cols?: number }) {
  const clips = useAppStateStore((state) => state.clips);
  const loading = useAppStateStore((state) => state.loading);
  const importToken = useAppStateStore((state) => state.importToken);
  const setFocusedClip = useAppStateStore((state) => state.setFocusedClip);
  const setFocusedClipId = useAppStateStore((state) => state.setFocusedClipId);
  const setSelectedClips = useAppStateStore((state) => state.setSelectedClips);
  const setLoading = useAppStateStore((state) => state.setLoading);

  const defaultCols = useUIStateStore((state) => state.cols);
  // Subscribe only to the settings field used during render. Reading the whole
  // settings store here re-rendered the entire grid on any settings change.
  const episodesPath = useGeneralSettingsStore((state) => state.episodesPath);
  const openedEpisodeId = useEpisodePanelRuntimeStore((state) => state.openedEpisodeId);
  const episodes = useEpisodePanelRuntimeStore((state) => state.episodes);

  const activeCols = cols ?? defaultCols;

  // Preview mode is a per-episode property fixed at import time — NOT the global
  // import-method setting. Legacy episodes without a stored method are inferred
  // from whether their clips have cut video paths. Memoized so the O(n) clip scan
  // doesn't run on every scroll-driven re-render.
  const episodeVideoPreview = useMemo(() => {
    const openedEpisode = episodes.find((e) => e.id === openedEpisodeId);
    return (
      openedEpisode?.importMethod === "video_files" ||
      (openedEpisode?.importMethod === undefined && clips.some((c) => Boolean(c.clipPath)))
    );
  }, [episodes, openedEpisodeId, clips]);

  // Proxy queue: manages HEVC/H.264 proxy generation and prioritization
  const { requestProxySequential, reportProxyDemand } = useViewportAwareProxyQueue();
  // WebP queue: generates scene previews using viewport/hover priority
  const { reportWebpDemand, primeFromDiskCache, resetWebpQueue } = useViewportAwareWebpQueue({
    episodeCacheId: openedEpisodeId,
    customPath: episodesPath,
  });
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
      // Read settings at call time so this callback stays referentially stable —
      // it's passed to every tile, so depending on the settings object would
      // re-render the whole grid whenever any setting changed.
      const settings = useGeneralSettingsStore.getState();
      const activeProfile = settings.exportProfiles.find(
        (candidate) => candidate.id === settings.activeExportProfileId
      ) ?? settings.exportProfiles[0];
      const format = activeProfile?.container || settings.exportFormat || "mp4";
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

      if (settings.openFileLocationAfterExport && exportedFiles.length > 0) {
        await invoke("reveal_in_file_manager", { filePath: exportedFiles[0] });
      }
    } catch (err) {
      console.error("Single clip download failed:", err);
    } finally {
      setLoading(false);
    }
  }, [setLoading]);

  const handleClipClick = useCallback(
    (clipId: string, clipSrc: string, index: number, e: React.MouseEvent<HTMLDivElement>) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      const state = useAppStateStore.getState();
      // Read clips from the store at click time rather than closing over them, so
      // this callback stays stable across clip patches (streaming import) and
      // doesn't re-render every memoized tile each time a clip updates.
      const currentClips = state.clips;

      // Shift-click: select a range of clips
      if (isShift) {
        const anchorIndex = state.focusedClipId
          ? currentClips.findIndex((c) => c.id === state.focusedClipId)
          : -1;
        const startIndex = anchorIndex !== -1 ? anchorIndex : index;
        const [start, end] = [startIndex, index].sort((a, b) => a - b);
        const rangeIds = currentClips.slice(start, end + 1).map((c) => c.id);

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
      setFocusedClipId(clipId);
    },
    [setFocusedClip, setFocusedClipId, setSelectedClips]
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

  // Windowing: render only the rows near the viewport. Disabled while the loading
  // skeleton is up (a fixed 12 tiles — nothing to virtualize).
  const { startIndex, endIndex, offsetY, totalHeight } = useGridVirtualizer({
    containerRef,
    columns: gridColumns,
    itemCount: clips.length,
    enabled: !loading,
  });

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
    resetWebpQueue();
  }, [importToken, resetWebpQueue]);

  useEffect(() => {
    // The WebP disk-cache prime only applies to WebP-preview episodes; video
    // episodes show cut clips and never touch the WebP cache.
    if (episodeVideoPreview) {
      return;
    }

    if (!openedEpisodeId || clips.length === 0) return;

    // On an episode switch, `openedEpisodeId` updates one render before the
    // transition-deferred `clips` do. Clip ids are `${episodeId}_${sceneIndex}`,
    // so a leading-id mismatch means these clips still belong to the previous
    // episode — skip the throwaway cache lookup until `clips` catches up.
    if (!clips[0].id.startsWith(openedEpisodeId)) return;

    const jobs = clips
      .map((clip) => {
        if (clip.clipPath) return null; // video-mode clips don't use WebP queue

        const sourcePath = clip.originalPath || clip.src;
        const start = clip.startSec ?? 0;
        const rawEnd = clip.endSec ?? (start + 2);
        const end = Math.min(rawEnd > start ? rawEnd : start + 2, start + 2.5);

        if (!sourcePath) return null;
        return {
          clipId: clip.id,
          sourcePath,
          start,
          end,
          fps: 8,
        };
      })
      .filter((job): job is NonNullable<typeof job> => Boolean(job));

    void primeFromDiskCache(jobs);
  }, [clips, episodeVideoPreview, openedEpisodeId, primeFromDiskCache]);

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
        <div className="empty-grid-wrapper">
          <p id="empty-grid">No video loaded.<br/>If no clips are displaying, try changing the episode storage path in general settings.</p>
        </div>
      ) : loading ? (
        <div
          className="clips-grid"
          style={{
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            ["--clip-max-width" as any]: clipMaxWidth,
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="clip-skeleton" />
          ))}
        </div>
      ) : (
        // Virtualized: a full-height spacer drives the scrollbar; only the rows
        // near the viewport are rendered, offset into place with translateY.
        <div className="clips-virtual-spacer" style={{ position: "relative", height: totalHeight }}>
          <div
            className="clips-grid"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              ["--clip-max-width" as any]: clipMaxWidth,
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${offsetY}px)`,
              // Vertical insets are handled by the spacer/offset; keep only the
              // original horizontal padding here.
              padding: "0 15px",
            }}
          >
            {clips.slice(startIndex, endIndex).map((clip, i) => {
              const index = startIndex + i;
              return (
                <LazyClip
                  key={clip.id}
                  clip={clip}
                  index={index}
                  videoPreviewMode={episodeVideoPreview}
                  requestProxySequential={requestProxySequential}
                  reportProxyDemand={reportProxyDemand}
                  reportWebpDemand={reportWebpDemand}
                  reportStaggerDemand={reportStaggerDemand}
                  onClipClick={handleClipClick}
                  onClipDoubleClick={handleClipDoubleClick}
                  onToggleSelection={handleToggleSelection}
                  onDownloadClip={handleDownloadSingleClip}
                />
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
