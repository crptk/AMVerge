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
import { ClipContainerProps } from "./types.ts";
import { useAppStateStore } from "../../store/appStore.ts";
import { useUIStateStore } from "../../store/UIStore.ts";

export default function ClipsContainer(props: ClipContainerProps) {
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const clips = useAppStateStore(s => s.clips);

  const selectedClips = useAppStateStore(s => s.selectedClips);
  const setSelectedClips = useAppStateStore(s => s.setSelectedClips);
  
  const focusedClip = useAppStateStore(s => s.focusedClip);
  const setFocusedClip = useAppStateStore(s => s.setFocusedClip);

  const loading = useAppStateStore(s => s.loading);

  const cols = useUIStateStore(s => s.cols);
  const importToken = useAppStateStore(s => s.importToken);

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
    ? cols
    : Math.max(1, Math.min(cols, clips.length));

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

      // Shift-click: select a range of clips
      if (isShift) {
        const anchorIndex = focusedClip
          ? clips.findIndex((c) => c.src === focusedClip)
          : -1;
        const startIndex = anchorIndex !== -1 ? anchorIndex : index;
        const [start, end] = [startIndex, index].sort((a, b) => a - b);
        const rangeIds =clips.slice(start, end + 1).map((c) => c.id);

        startTransition(() => {
          setSelectedClips(new Set(rangeIds));
        });
        return;
      }

      // Ctrl/Cmd-click: toggle selection for this clip
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

      // Single click: focus this clip (no selection change)
      setFocusedClip(clipSrc);
    },
    [clips, focusedClip, setFocusedClip, setSelectedClips]
  );

  const handleToggleTimeline = useCallback(
    (clipId: string, e: React.MouseEvent) => {
      e.stopPropagation(); // Don't trigger focus click
      startTransition(() => {
        props.setTimelineClipIds((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [props.setTimelineClipIds]
  );

  // Handles double-click on a clip tile (focus + toggle selection)
  const handleClipDoubleClick = useCallback(
    (clipId: string, clipSrc: string, _index: number, _e: React.MouseEvent<HTMLDivElement>) => {
      setFocusedClip(clipSrc);
      startTransition(() => {
        setSelectedClips((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [setFocusedClip, setSelectedClips]
  );

  const handleToggleSelection = useCallback(
    (clipId: string, selected: boolean) => {
      startTransition(() => {
        setSelectedClips((prev) => {
          const next = new Set(prev);
          selected ? next.add(clipId) : next.delete(clipId);
          return next;
        });
      });
    },
    [setSelectedClips]
  );

  // Ref for the main container (for scroll-to-top on import)
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [importToken]);

  return (
    <main className="clips-container" ref={containerRef}>
      {props.isEmpty ? (
        <p id="empty-grid">No video loaded.</p>
      ) : (
        <div
          ref={props.gridRef}
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
                  isExportSelected={(selectedClips ?? new Set()).has(clip.id)}
                  isSelected={(selectedClips ?? new Set()).has(clip.id)}
                  isFocused={focusedClip === clip.src}
                  requestProxySequential={requestProxySequential}
                  reportProxyDemand={reportProxyDemand}
                  registerVideoRef={registerVideoRef}
                  reportStaggerDemand={reportStaggerDemand}
                  onClipClick={handleClipClick}
                  onClipDoubleClick={handleClipDoubleClick}
                  onToggleTimeline={handleToggleTimeline}
                  onToggleSelection={handleToggleSelection}
                  userHasHEVC={props.userHasHEVC}
                  onDownloadClip={props.onDownloadClip}
                />
              ))}
        </div>
      )}
    </main>
  );
}