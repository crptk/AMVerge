import React, { useRef, useCallback, useEffect } from "react";
import type { UseTimelineReturn } from "../../hooks/useTimeline";
import TimelineSegmentChip from "./TimelineSegmentChip";
import TimelinePlayhead from "./TimelinePlayhead";
import TimelineRuler from "./TimelineRuler";
import "../../styles/home/timeline.css";

type Props = {
  timeline: UseTimelineReturn;
  /** Height of the track area in px (default 64). */
  trackHeight?: number;
};

/**
 * Root timeline component.
 *
 * ┌─────────────────────────────────────────────────┐
 * │  TimelineToolbar  (split / merge / zoom)         │
 * ├─────────────────────────────────────────────────┤
 * │  TimelineRuler   (time markings)                 │
 * ├─────────────────────────────────────────────────┤
 * │  ▓▓▓▓  ▓▓▓▓▓▓▓  ▓▓▓   track area + playhead   │
 * └─────────────────────────────────────────────────┘
 */
export default function TimelineTrack({ timeline, trackHeight = 96 }: Props) {
  const {
    state,
    setPlayhead,
    splitAtPlayhead,
    mergeSelected,
    deleteSelected,
    toggleSelect,
    selectRange,
    deselectAll,
    startDrag,
    moveDrag,
    endDrag,
    zoom,
    setScroll,
    secToPx,
    pxToSec,
    undo,
    redo,
    zoomToFit,
  } = timeline;

  const trackRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playheadRafRef = useRef<number | null>(null);
  const hasAutoFittedRef = useRef(false);

  // ── Total width in px ──────────────────────────────────────────────
  const totalWidthPx =
    state.totalDuration * state.viewport.zoom.pxPerSecond;

  // ── Wheel → zoom or scroll ────────────────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom (Ctrl+scroll)
        e.preventDefault();
        const rect = trackRef.current?.getBoundingClientRect();
        const anchorPx = rect ? e.clientX - rect.left : 0;
        const anchorSec = pxToSec(anchorPx);
        zoom(e.deltaY > 0 ? -1 : 1, anchorSec);
      } else {
        // Horizontal scroll
        const deltaSec =
          (e.deltaY + e.deltaX) / state.viewport.zoom.pxPerSecond;
        setScroll(state.viewport.scrollOffsetSec + deltaSec);
      }
    },
    [pxToSec, zoom, setScroll, state.viewport]
  );

  // ── RAF-throttled playhead move ────────────────────────────────────
  const movePlayheadToClientX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sec = pxToSec(clientX - rect.left);
    setPlayhead(sec);
  }, [setPlayhead, pxToSec]);

  const movePlayheadThrottled = useCallback((clientX: number) => {
    if (playheadRafRef.current) return;
    playheadRafRef.current = requestAnimationFrame(() => {
      movePlayheadToClientX(clientX);
      playheadRafRef.current = null;
    });
  }, [movePlayheadToClientX]);

  // ── Auto-follow: scroll viewport to keep playhead visible ─────────
  useEffect(() => {
    if (!wrapperRef.current) return;
    const wrapper = wrapperRef.current;
    const viewportWidthSec = wrapper.clientWidth / state.viewport.zoom.pxPerSecond;
    const playheadRelativeSec = state.playheadSec - state.viewport.scrollOffsetSec;

    // Auto-scroll when playhead is past 80% of viewport or before 10%
    if (playheadRelativeSec > viewportWidthSec * 0.85) {
      setScroll(state.playheadSec - viewportWidthSec * 0.3);
    } else if (playheadRelativeSec < viewportWidthSec * 0.1 && state.viewport.scrollOffsetSec > 0) {
      setScroll(Math.max(0, state.playheadSec - viewportWidthSec * 0.3));
    }
  }, [state.playheadSec, state.viewport.zoom.pxPerSecond]);

  // ── Click on ruler → move playhead + scrub ──────────────────────
  const handleRulerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      console.log("[TimelineTrack] Ruler PointerDown - Starting Drag");
      timeline.setIsDraggingPlayhead(true);
      movePlayheadToClientX(e.clientX);

      const onMove = (ev: PointerEvent) => movePlayheadThrottled(ev.clientX);
      const onUp = () => {
        console.log("[TimelineTrack] Ruler PointerUp - Ending Drag");
        timeline.setIsDraggingPlayhead(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (playheadRafRef.current) {
          cancelAnimationFrame(playheadRafRef.current);
          playheadRafRef.current = null;
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [movePlayheadToClientX, movePlayheadThrottled, timeline.setIsDraggingPlayhead]
  );

  // ── Click on empty track → move playhead ──────────────────────────
  const handleTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only on direct track clicks (not segments)
      if (e.target !== trackRef.current) return;
      movePlayheadToClientX(e.clientX);
      deselectAll();
    },
    [movePlayheadToClientX, deselectAll]
  );

  // ── Segment pointer events ─────────────────────────────────────────
  const handleSegmentPointerDown = useCallback(
    (
      e: React.PointerEvent,
      segmentId: string,
      edge: "left" | "right" | "body"
    ) => {
      e.stopPropagation();

      if (e.shiftKey) {
        selectRange(segmentId);
        return;
      }

      if (edge === "body") {
        toggleSelect(segmentId, e.ctrlKey || e.metaKey);
      }

      startDrag(segmentId, edge, e.clientX);

      const onPointerMove = (ev: PointerEvent) => moveDrag(ev.clientX);
      const onPointerUp = () => {
        endDrag();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [toggleSelect, selectRange, startDrag, moveDrag, endDrag]
  );

  // ── Playhead drag ──────────────────────────────────────────────────
  const handlePlayheadPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      console.log("[TimelineTrack] Playhead PointerDown - Starting Drag");
      timeline.setIsDraggingPlayhead(true);

      const onMove = (ev: PointerEvent) => movePlayheadThrottled(ev.clientX);
      const onUp = () => {
        console.log("[TimelineTrack] Playhead PointerUp - Ending Drag");
        timeline.setIsDraggingPlayhead(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (playheadRafRef.current) {
          cancelAnimationFrame(playheadRafRef.current);
          playheadRafRef.current = null;
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [movePlayheadThrottled, timeline.setIsDraggingPlayhead]
  );

  // Shortcuts are handled by EditorPage.tsx to avoid double-firing
  /*
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
        // ...
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [...]);
  */

  // ── Auto-zoom to fit ONLY on first init ────────────────────────────
  useEffect(() => {
    if (state.totalDuration <= 0 || hasAutoFittedRef.current) return;
    if (!wrapperRef.current) return;
    hasAutoFittedRef.current = true;
    zoomToFit(wrapperRef.current.clientWidth);
  }, [state.totalDuration, zoomToFit]);

  // Reset auto-fit flag when timeline is cleared
  useEffect(() => {
    if (state.segments.length === 0) {
      hasAutoFittedRef.current = false;
    }
  }, [state.segments.length]);

  // ── Render ─────────────────────────────────────────────────────────

  const playheadPx = secToPx(state.playheadSec);
  const canMerge = state.selectedIds.size >= 2;
  const canSplit = state.segments.some(
    (s) =>
      state.playheadSec > s.start + 1 / 30 &&
      state.playheadSec < s.end - 1 / 30
  );
  const canDelete = state.selectedIds.size > 0;

  return (
    <div className="tl-root" id="timeline-root">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="tl-toolbar" id="timeline-toolbar">
        <div className="tl-toolbar-group">
          <button
            className="tl-btn"
            id="tl-btn-split"
            disabled={!canSplit}
            onClick={splitAtPlayhead}
            title="Split at playhead (S)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 4l5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
              <path d="M13 4l-5 4 5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
            </svg>
            <span>Split</span>
          </button>

          <button
            className="tl-btn"
            id="tl-btn-merge"
            disabled={!canMerge}
            onClick={mergeSelected}
            title="Merge selected (M)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M5 4l-3 4 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
              <path d="M11 4l3 4-3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
            </svg>
            <span>Merge</span>
          </button>

          <button
            className="tl-btn tl-btn-danger"
            id="tl-btn-delete"
            disabled={!canDelete}
            onClick={deleteSelected}
            title="Delete selected (Del)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Delete</span>
          </button>
        </div>

        <div className="tl-toolbar-group">
          <button
            className="tl-btn tl-btn-icon"
            onClick={undo}
            disabled={state.history.past.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 7l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M1 10h10a4 4 0 0 0 0-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="tl-btn tl-btn-icon"
            onClick={redo}
            disabled={state.history.future.length === 0}
            title="Redo (Ctrl+Y)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 7l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 10H5a4 4 0 0 1 0-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="tl-toolbar-group tl-toolbar-info">
          <span className="tl-time-display" id="tl-playhead-time">
            {formatTimecode(state.playheadSec)}
          </span>
          <span className="tl-separator">|</span>
          <span className="tl-duration-display" id="tl-total-duration">
            {formatTimecode(state.totalDuration)}
          </span>
        </div>

        <div className="tl-toolbar-group">
          <button
            className="tl-btn tl-btn-icon"
            id="tl-btn-zoom-out"
            onClick={() => zoom(-1)}
            title="Zoom out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4.5 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="tl-zoom-bar" id="tl-zoom-bar">
            <div
              className="tl-zoom-fill"
              style={{
                width: `${((state.viewport.zoom.pxPerSecond - 2) / (600 - 2)) * 100}%`,
              }}
            />
          </div>

          <button
            className="tl-btn tl-btn-icon"
            id="tl-btn-zoom-in"
            onClick={() => zoom(1)}
            title="Zoom in"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4.5 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M7 4.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <button
            className="tl-btn tl-btn-fit"
            onClick={() => {
              if (wrapperRef.current) {
                zoomToFit(wrapperRef.current.clientWidth);
              }
            }}
            title="Fit to screen"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Fit</span>
          </button>
        </div>
      </div>

      {/* ── Ruler + Track area (scrollable together) ─────────────── */}
      <div
        className="tl-track-wrapper"
        id="timeline-track-wrapper"
        ref={wrapperRef}
        onWheel={handleWheel}
      >
        {/* Ruler inside the scrollable wrapper so it scrolls with track */}
        <div className="tl-ruler-track-container" style={{ width: totalWidthPx, minWidth: '100%' }}>
          <TimelineRuler
            totalDuration={state.totalDuration}
            viewport={state.viewport}
            secToPx={secToPx}
            onPointerDown={handleRulerPointerDown}
          />

          <div
            className="tl-track"
            id="timeline-track"
            ref={trackRef}
            style={{
              width: totalWidthPx,
              height: trackHeight,
            }}
            onPointerDown={handleTrackPointerDown}
          >
            {state.segments.map((seg) => (
              <TimelineSegmentChip
                key={seg.id}
                segment={seg}
                isSelected={state.selectedIds.has(seg.id)}
                isDragging={state.drag?.segmentId === seg.id}
                left={secToPx(seg.start)}
                width={
                  (seg.end - seg.start) * state.viewport.zoom.pxPerSecond
                }
                height={trackHeight}
                onPointerDown={handleSegmentPointerDown}
              />
            ))}

            {/* ── Playhead ──────────────────────────────────────── */}
            <TimelinePlayhead
              leftPx={playheadPx}
              height={trackHeight}
              timecode={formatTimecode(state.playheadSec)}
              onPointerDown={handlePlayheadPointerDown}
            />
          </div>
        </div>
      </div>

      {/* ── Selection info bar ────────────────────────────────── */}
      {state.selectedIds.size > 0 && (
        <div className="tl-selection-bar" id="tl-selection-bar">
          <span className="tl-selection-count">
            {state.selectedIds.size} segment{state.selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          {canMerge && (
            <span className="tl-selection-hint">
              Press <kbd>M</kbd> to merge
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Timecode formatter ───────────────────────────────────────────────

function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30); // 30 fps frame index

  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
    String(f).padStart(2, "0")
  ].join(":");
}
