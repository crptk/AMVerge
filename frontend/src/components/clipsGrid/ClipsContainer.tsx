/**
 * ClipsContainer.tsx
 *
 * Main grid container for displaying video clips. Handles layout, selection logic, and passes props to each tile (LazyClip).
 * Optimized for performance with lazy loading, proxying, and staggered mounting.
 */
import { startTransition, useCallback, useEffect, useRef } from "react";
import { LazyClip } from "./LazyClip.tsx"
import { useStaggeredMountQueue } from "./staggeredMountQueue.ts";
import useViewportAwareProxyQueue from "./proxyQueue.ts";
import { useAppStateStore } from "../../stores/appStore.ts";
import { useUIStateStore } from "../../stores/UIStore.ts";
import useImportExport from "../../hooks/useImportExport.ts";

export default function ClipsContainer({ cols }: { cols?: number }) {
  // Holds refs to all video elements by clip ID
  const clips = useAppStateStore((state) => state.clips);
  const loading = useAppStateStore((state) => state.loading);
  const importToken = useAppStateStore((state) => state.importToken);
  const focusedClip = useAppStateStore((state) => state.focusedClip);
  const setFocusedClip = useAppStateStore((state) => state.setFocusedClip);
  const setSelectedClips = useAppStateStore((state) => state.setSelectedClips);
  const setTimelineClipIds = useAppStateStore((state) => state.setTimelineClipIds);
  const defaultCols = useUIStateStore((state) => state.cols);
  const { handleDownloadSingleClip } = useImportExport();

  const activeCols = cols ?? defaultCols;

  // Holds refs to all video elements by clip ID
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Clean up refs for clips that are no longer present
  useEffect(() => {
    const validClipIds = new Set(clips.map((c) => c.id));
    const refs = videoRefs.current;
    for (const key of Object.keys(refs)) {
      if (!validClipIds.has(key)) delete refs[key];
    }
  }, [clips]);

  // Proxy queue: manages HEVC/H.264 proxy generation and prioritization
  const { requestProxySequential, reportProxyDemand } = useViewportAwareProxyQueue();
  // Staggered mount queue: mounts videos one at a time in grid preview
  const { reportStaggerDemand } = useStaggeredMountQueue();

  // Calculate number of columns for the grid
  const gridColumns = loading
    ? activeCols
    : Math.max(1, Math.min(activeCols, clips.length));

  // Set max width for clips (wider if only 1-2 clips)
  const clipMaxWidth = !loading && clips.length <= 2 ? 520 : 260;

  // Register a video element ref for a given clip
  const registerVideoRef = useCallback((clipId: string, el: HTMLVideoElement | null) => {
    videoRefs.current[clipId] = el;
  }, []);

  // Handles click on a clip tile (focus/select logic)
  const handleClipClick = useCallback(
    (clipId: string, clipSrc: string, index: number, e: React.MouseEvent<HTMLDivElement>) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      // Shift-click: select a range of clips for the timeline
      if (isShift) {
        const anchorIndex = focusedClip
          ? clips.findIndex((c) => c.src === focusedClip)
          : -1;
        const startIndex = anchorIndex !== -1 ? anchorIndex : index;
        const [start, end] = [startIndex, index].sort((a, b) => a - b);
        const rangeIds = clips.slice(start, end + 1).map((c) => c.id);

        startTransition(() => {
          setSelectedClips(new Set(rangeIds));
        });
        return;
      }

      // Ctrl/Cmd-click: toggle timeline state for this clip
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

      // Single click: focus this clip for preview (NO timeline change)
      setFocusedClip(clipSrc);
    },
    [clips, focusedClip, setFocusedClip, setSelectedClips]
  );

  // Handles explicit timeline toggle (from the Plus/Check button)
  const handleToggleTimeline = useCallback(
    (clipId: string, e: React.MouseEvent) => {
      e.stopPropagation(); // Don't trigger focus click
      startTransition(() => {
        setTimelineClipIds((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [setTimelineClipIds]
  );

  // Handles double-click on a clip tile (toggle timeline/export selection — checkmark only)
  const handleClipDoubleClick = useCallback(
    (clipId: string, _clipSrc: string, _index: number, _e: React.MouseEvent<HTMLDivElement>) => {
      startTransition(() => {
        setTimelineClipIds((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [setTimelineClipIds]
  );


  // Ref for the main container (for scroll-to-top on import)
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [importToken]);

  return (
    <main className="clips-container" ref={containerRef}>
      {clips.length === 0 ? (
        <p id="empty-grid">No video loaded.</p>
      ) : (
        <div
          className="clips-grid"
          style={{
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            ["--clip-max-width" as any]: `${clipMaxWidth}px`,
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
                  registerVideoRef={registerVideoRef}
                  reportStaggerDemand={reportStaggerDemand}
                  onClipClick={handleClipClick}
                  onClipDoubleClick={handleClipDoubleClick}
                  onToggleTimeline={handleToggleTimeline}
                  onDownloadClip={handleDownloadSingleClip}
                />
              ))}
        </div>
      )}
    </main>
  );
}