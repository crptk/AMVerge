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

export default function ClipsContainer(props: ClipContainerProps) {
  // Holds refs to all video elements by clip ID
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Clean up refs for clips that are no longer present
  useEffect(() => {
    const validClipIds = new Set(props.clips.map((c) => c.id));
    const refs = videoRefs.current;
    for (const key of Object.keys(refs)) {
      if (!validClipIds.has(key)) delete refs[key];
    }
  }, [props.clips]);

  // Proxy queue: manages HEVC/H.264 proxy generation and prioritization
  const { requestProxySequential, reportProxyDemand } = useViewportAwareProxyQueue();
  // Staggered mount queue: mounts videos one at a time in grid preview
  const { reportStaggerDemand } = useStaggeredMountQueue();

  // Calculate number of columns for the grid
  const gridColumns = props.loading
    ? props.cols
    : Math.max(1, Math.min(props.cols, props.clips.length));

  // Set max width for clips (wider if only 1-2 clips)
  const clipMaxWidth = !props.loading && props.clips.length <= 2 ? 520 : 260;

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
        const anchorIndex = props.focusedClip
          ? props.clips.findIndex((c) => c.src === props.focusedClip)
          : -1;
        const startIndex = anchorIndex !== -1 ? anchorIndex : index;
        const [start, end] = [startIndex, index].sort((a, b) => a - b);
        const rangeIds = props.clips.slice(start, end + 1).map((c) => c.id);

        startTransition(() => {
          props.setSelectedClips(new Set(rangeIds));
        });
        return;
      }

      // Ctrl/Cmd-click: toggle timeline state for this clip
      if (isCtrlOrCmd) {
        startTransition(() => {
          props.setSelectedClips((prev) => {
            const next = new Set(prev);
            next.has(clipId) ? next.delete(clipId) : next.add(clipId);
            return next;
          });
        });
        return;
      }

      // Single click: focus this clip for preview (NO timeline change)
      props.setFocusedClip(clipSrc);
    },
    [props.clips, props.focusedClip, props.setFocusedClip, props.setSelectedClips]
  );

  // Handles explicit timeline toggle (from the Plus/Check button)
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
      props.setFocusedClip(clipSrc);
      startTransition(() => {
        props.setSelectedClips((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [props.setFocusedClip, props.setSelectedClips]
  );

  // Handles explicit grid selection toggle
  const handleToggleSelection = useCallback(
    (clipId: string, selected: boolean) => {
      startTransition(() => {
        props.setSelectedClips((prev) => {
          const next = new Set(prev);
          selected ? next.add(clipId) : next.delete(clipId);
          return next;
        });
      });
    },
    [props.setSelectedClips]
  );

  // Ref for the main container (for scroll-to-top on import)
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [props.importToken]);

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
          {props.loading
            ? Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="clip-skeleton" />
              ))
            : props.clips.map((clip, index) => (
                <LazyClip
                  key={clip.id}
                  clip={clip}
                  index={index}
                  importToken={props.importToken}
                  isExportSelected={(props.timelineClipIds ?? new Set()).has(clip.id)}
                  isSelected={(props.selectedClips ?? new Set()).has(clip.id)}
                  isFocused={props.focusedClip === clip.src}
                  gridPreview={props.gridPreview}
                  requestProxySequential={requestProxySequential}
                  reportProxyDemand={reportProxyDemand}
                  registerVideoRef={registerVideoRef}
                  reportStaggerDemand={reportStaggerDemand}
                  onClipClick={handleClipClick}
                  onClipDoubleClick={handleClipDoubleClick}
                  onToggleTimeline={handleToggleTimeline}
                  onToggleSelection={handleToggleSelection}
                  videoIsHEVC={props.videoIsHEVC}
                  userHasHEVC={props.userHasHEVC}
                  generalSettings={props.generalSettings}
                  onDownloadClip={props.onDownloadClip}
                  themeSettings={props.themeSettings}
                />
              ))}
        </div>
      )}
    </main>
  );
}