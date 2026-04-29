import { useReducer, useCallback, useRef, useEffect } from "react";
import type {
  TimelineSegment,
  TimelineState,
  DragInfo,
  DragEdge,
} from "../types/timeline";

// ─── Helpers ─────────────────────────────────────────────────────────

let _nextId = 1;
function genId(): string {
  return `seg_${Date.now()}_${_nextId++}`;
}

/** Clamp a value between min and max. */
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Minimum segment duration in seconds (≈ 1 frame @ 30 fps). */
const MIN_DURATION_SEC = 1 / 30;

/** Zoom boundaries. */
const MIN_PX_PER_SEC = 2;
const MAX_PX_PER_SEC = 600;

// ─── Actions ─────────────────────────────────────────────────────────

type Action =
  | { type: "INIT"; segments: TimelineSegment[]; totalDuration: number }
  | { type: "SET_PLAYHEAD"; sec: number }
  | { type: "SPLIT_AT_PLAYHEAD" }
  | { type: "MERGE_SELECTED" }
  | { type: "MERGE_SUCCESS"; id: string; newSrc: string }
  | { type: "MERGE_ERROR"; id: string }
  | { type: "SPLIT_SUCCESS"; id: string; part: 1 | 2; newSrc: string; newThumb?: string; newDuration: number }
  | { type: "SPLIT_ERROR"; id: string }
  | { type: "DELETE_SELECTED" }
  | { type: "TOGGLE_SELECT"; id: string; additive: boolean }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "SELECT_RANGE"; fromId: string; toId: string }
  | { type: "DRAG_START"; info: DragInfo }
  | { type: "DRAG_MOVE"; currentX: number }
  | { type: "DRAG_END" }
  | { type: "ZOOM"; delta: number; anchorSec?: number }
  | { type: "SET_ZOOM"; pxPerSecond: number }
  | { type: "SET_SCROLL"; offsetSec: number }
  | { type: "UPDATE_SEGMENT"; id: string; start: number; end: number }
  | { type: "RENAME_SEGMENT"; id: string; label: string }
  | { type: "UNDO" }
  | { type: "REDO" };

// ─── Initial state ──────────────────────────────────────────────────

function makeInitialState(): TimelineState {
  return {
    segments: [],
    totalDuration: 0,
    playheadSec: 0,
    selectedIds: new Set(),
    viewport: {
      scrollOffsetSec: 0,
      zoom: { pxPerSecond: 80 },
    },
    drag: null,
    history: { past: [], future: [] },
  };
}

// ─── Reducer ─────────────────────────────────────────────────────────

function timelineReducer(state: TimelineState, action: Action): TimelineState {
  const { segments, history } = state;

  const record = (newSegments: TimelineSegment[], clearFuture = true): TimelineState => ({
    ...state,
    segments: newSegments,
    history: {
      past: [...history.past.slice(-49), segments],
      future: clearFuture ? [] : history.future,
    },
  });

  switch (action.type) {
    case "UNDO": {
      if (history.past.length === 0) return state;
      const prev = history.past[history.past.length - 1];
      return {
        ...state,
        segments: prev,
        history: {
          past: history.past.slice(0, -1),
          future: [segments, ...history.future],
        },
      };
    }
    case "REDO": {
      if (history.future.length === 0) return state;
      const next = history.future[0];
      return {
        ...state,
        segments: next,
        history: {
          past: [...history.past, segments],
          future: history.future.slice(1),
        },
      };
    }
    // ── Bootstrap ────────────────────────────────────────────────────
    case "INIT": {
      const initializedSegments = action.segments.map((s) => ({
        ...s,
        sourceClips: s.sourceClips, // Preserve the playlist!
        sourceStart: s.sourceStart ?? s.sourceClip?.start ?? 0,
        sourceEnd: s.sourceEnd ?? s.sourceClip?.end ?? 0,
      }));
      return {
        ...makeInitialState(),
        segments: initializedSegments,
        selectedIds: new Set(initializedSegments.map(s => s.id)), // Auto-select all
        totalDuration: action.totalDuration,
        viewport: {
          scrollOffsetSec: 0,
          zoom: { pxPerSecond: 80 },
        },
      };
    }

    // ── Playhead ─────────────────────────────────────────────────────
    case "SET_PLAYHEAD": {
      return {
        ...state,
        playheadSec: clamp(action.sec, 0, state.totalDuration),
      };
    }

    // ── Split ────────────────────────────────────────────────────────
    case "SPLIT_AT_PLAYHEAD": {
      const t = state.playheadSec;
      const target = state.segments.find(
        (s) => t > s.start + MIN_DURATION_SEC && t < s.end - MIN_DURATION_SEC
      );
      if (!target) return state;

      const durationLeft = t - target.start;
      const splitSourcePos = (target.sourceStart ?? 0) + durationLeft;
      const inputPath = target.sourceClip?.src || "";

      const left: TimelineSegment = {
        ...target,
        id: genId(),
        end: t,
        sourceEnd: splitSourcePos,
        label: "Splitting...",
        isProcessing: true,
        splitInfo: { originalId: target.id, part: 1, splitTime: durationLeft, inputPath }
      };
      const right: TimelineSegment = {
        ...target,
        id: genId(),
        start: t,
        sourceStart: splitSourcePos,
        label: "Splitting...",
        isProcessing: true,
        splitInfo: { originalId: target.id, part: 2, splitTime: durationLeft, inputPath }
      };

      const newSegments = state.segments.flatMap((s) =>
        s.id === target.id ? [left, right] : [s]
      );

      const nextState = record(newSegments);
      return { ...nextState, selectedIds: new Set() }; // Clear selection
    }

    // ── Merge ────────────────────────────────────────────────────────
    case "MERGE_SELECTED": {
      if (state.selectedIds.size < 2) return state;

      // Gather selected, sorted by start time
      const selected = state.segments
        .filter((s) => state.selectedIds.has(s.id))
        .sort((a, b) => a.start - b.start);

      if (selected.length < 2) return state;

      // Check adjacency — each segment.start must equal prev segment.end
      for (let i = 1; i < selected.length; i++) {
        if (Math.abs(selected[i].start - selected[i - 1].end) > 0.01) {
          console.warn("[Timeline] Cannot merge: Segments are not adjacent", {
            prevEnd: selected[i-1].end,
            nextStart: selected[i].start
          });
          return state;
        }
      }

      console.log("[Timeline] Merging segments:", selected.map(s => ({ 
        id: s.id, 
        timelineRange: `${s.start}-${s.end}`,
        sourceRange: `${s.sourceStart}-${s.sourceEnd}` 
      })));
      const mergedId = genId();
      const merged: TimelineSegment = {
        id: mergedId,
        start: selected[0].start,
        end: selected[selected.length - 1].end,
        label: "Merging...",
        sourceClip: selected[0].sourceClip,
        sourceClips: selected.flatMap(s => s.sourceClips ?? (s.sourceClip ? [s.sourceClip] : [])),
        sourceStart: selected[0].sourceStart,
        sourceEnd: selected[selected.length - 1].sourceEnd,
        isProcessing: true,
      };

      const removedIds = new Set(selected.map((s) => s.id));
      let replaced = false;
      const newSegments: TimelineSegment[] = [];
      for (const s of state.segments) {
        if (removedIds.has(s.id)) {
          if (!replaced) {
            newSegments.push(merged);
            replaced = true;
          }
        } else {
          newSegments.push(s);
        }
      }
      const nextState = record(newSegments);
      return { ...nextState, selectedIds: new Set() }; // Clear selection
    }

    case "MERGE_SUCCESS": {
      return {
        ...state,
        segments: state.segments.map(s => s.id === action.id ? { 
          ...s, 
          isProcessing: false, 
          label: "Merged",
          sourceClip: s.sourceClip ? { ...s.sourceClip, src: action.newSrc, srcList: [] } : undefined 
        } : s)
      };
    }

    case "MERGE_ERROR": {
      return {
        ...state,
        segments: state.segments.map(s => s.id === action.id ? { ...s, isProcessing: false, label: "Merge Failed" } : s)
      };
    }

    case "SPLIT_SUCCESS": {
      return {
        ...state,
        segments: state.segments.map(s => (s.id === action.id) ? {
          ...s,
          isProcessing: false,
          label: action.part === 1 ? "Split Part 1" : "Split Part 2",
          sourceClip: s.sourceClip ? {
            ...s.sourceClip,
            src: action.newSrc,
            thumbnail: action.newThumb || s.sourceClip.thumbnail,
            start: 0,
            end: action.newDuration
          } : undefined,
          splitInfo: undefined
        } : s)
      };
    }

    case "SPLIT_ERROR": {
      return {
        ...state,
        segments: state.segments.map(s => s.id === action.id ? { ...s, isProcessing: false, label: "Split Failed" } : s)
      };
    }

    // ── Delete ───────────────────────────────────────────────────────
    case "DELETE_SELECTED": {
      if (state.selectedIds.size === 0) return state;
      const remaining = state.segments.filter((s) => !state.selectedIds.has(s.id));

      // Close gaps: shift each segment so it starts where the previous one ends
      const closed: TimelineSegment[] = [];
      let cursor = 0;
      for (const seg of remaining) {
        const duration = seg.end - seg.start;
        closed.push({ ...seg, start: cursor, end: cursor + duration });
        cursor += duration;
      }

      const nextState = record(closed);
      // Update total duration to match the new end
      const newTotal = closed.length > 0 ? closed[closed.length - 1].end + 1 : 0;
      return { ...nextState, selectedIds: new Set(), totalDuration: newTotal };
    }

    // ── Selection ────────────────────────────────────────────────────
    case "TOGGLE_SELECT": {
      const next = new Set(action.additive ? state.selectedIds : []);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ...state, selectedIds: next };
    }

    case "SELECT_ALL":
      return {
        ...state,
        selectedIds: new Set(state.segments.map((s) => s.id)),
      };

    case "DESELECT_ALL":
      return { ...state, selectedIds: new Set() };

    case "SELECT_RANGE": {
      const fromIdx = state.segments.findIndex(
        (s) => s.id === action.fromId
      );
      const toIdx = state.segments.findIndex((s) => s.id === action.toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      const rangeIds = state.segments.slice(lo, hi + 1).map((s) => s.id);
      return { ...state, selectedIds: new Set(rangeIds) };
    }

    // ── Drag ─────────────────────────────────────────────────────────
    case "DRAG_START":
      return { ...state, drag: action.info };

    case "DRAG_MOVE": {
      if (!state.drag) return state;
      const {
        segmentId,
        edge,
        startX,
        originalStart,
        originalEnd,
        originalSourceStart,
        originalSourceEnd,
      } = state.drag;

      const pxPerSec = state.viewport.zoom.pxPerSecond;
      const deltaSec = (action.currentX - startX) / pxPerSec;

      const seg = state.segments.find((s) => s.id === segmentId);
      if (!seg) return state;

      let newStart = seg.start;
      let newEnd = seg.end;
      let newSourceStart = originalSourceStart;
      let newSourceEnd = originalSourceEnd;

      if (edge === "left") {
        newStart = Math.max(0, Math.min(originalStart + deltaSec, originalEnd - MIN_DURATION_SEC));
        // Source start shifts by the same amount the timeline start shifted
        newSourceStart = originalSourceStart + (newStart - originalStart);
      } else if (edge === "right") {
        newEnd = Math.max(originalStart + MIN_DURATION_SEC, Math.min(originalEnd + deltaSec, state.totalDuration));
        // Source end shifts by the same amount the timeline end shifted
        newSourceEnd = originalSourceEnd + (newEnd - originalEnd);
      } else {
        // Body dragging disabled
        return state;
      }

      const updatedSegments = state.segments.map((s) => {
        if (s.id !== segmentId) return s;
        return {
          ...s,
          start: newStart,
          end: newEnd,
          sourceStart: newSourceStart,
          sourceEnd: newSourceEnd,
        };
      });

      return { ...state, segments: updatedSegments };
    }

    case "DRAG_END":
      // Record a snapshot at the end of every drag interaction
      return {
        ...state,
        drag: null,
        history: {
          past: [...history.past.slice(-49), segments],
          future: [],
        },
      };

    // ── Zoom ─────────────────────────────────────────────────────────
    case "ZOOM": {
      const factor = 1 + action.delta * 0.1;
      const newPPS = clamp(
        state.viewport.zoom.pxPerSecond * factor,
        MIN_PX_PER_SEC,
        MAX_PX_PER_SEC
      );

      const anchor = action.anchorSec ?? state.playheadSec;
      // Keep the anchor point visually stable
      const oldScroll = state.viewport.scrollOffsetSec;
      const ratio = newPPS / state.viewport.zoom.pxPerSecond;
      const newScroll = anchor - (anchor - oldScroll) * (1 / ratio);

      return {
        ...state,
        viewport: {
          scrollOffsetSec: Math.max(0, newScroll),
          zoom: { pxPerSecond: newPPS },
        },
      };
    }

    case "SET_ZOOM":
      return {
        ...state,
        viewport: {
          ...state.viewport,
          zoom: {
            pxPerSecond: clamp(
              action.pxPerSecond,
              MIN_PX_PER_SEC,
              MAX_PX_PER_SEC
            ),
          },
        },
      };

    case "SET_SCROLL":
      return {
        ...state,
        viewport: {
          ...state.viewport,
          scrollOffsetSec: Math.max(0, action.offsetSec),
        },
      };

    // ── Direct edits ─────────────────────────────────────────────────
    case "UPDATE_SEGMENT": {
      return {
        ...state,
        segments: state.segments.map((s) =>
          s.id === action.id
            ? { ...s, start: action.start, end: action.end }
            : s
        ),
      };
    }

    case "RENAME_SEGMENT": {
      return {
        ...state,
        segments: state.segments.map((s) =>
          s.id === action.id ? { ...s, label: action.label } : s
        ),
      };
    }

    default:
      return state;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────

export default function useTimeline(onChange?: (segments: TimelineSegment[]) => void) {
  const [state, dispatch] = useReducer(timelineReducer, undefined, makeInitialState);
  const lastSelectRef = useRef<string | null>(null);
  const isInitRef = useRef(false);

  // Notify parent of segment changes
  const prevSegments = useRef(state.segments);
  useEffect(() => {
    if (state.segments !== prevSegments.current) {
      prevSegments.current = state.segments;
      if (isInitRef.current) {
        isInitRef.current = false; // skip notifying parent for programmatic init
      } else if (onChange) {
        onChange(state.segments);
      }
    }
  }, [state.segments, onChange]);

  // ── Public API (stable callbacks) ────────────────────────────────

  const init = useCallback(
    (segments: TimelineSegment[], totalDuration: number) => {
      isInitRef.current = true;
      dispatch({ type: "INIT", segments, totalDuration });
    },
    []
  );

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  const setPlayhead = useCallback(
    (sec: number) => dispatch({ type: "SET_PLAYHEAD", sec }),
    []
  );

  const splitAtPlayhead = useCallback(
    () => dispatch({ type: "SPLIT_AT_PLAYHEAD" }),
    []
  );

  const mergeSelected = useCallback(
    () => dispatch({ type: "MERGE_SELECTED" }),
    []
  );

  const deleteSelected = useCallback(
    () => dispatch({ type: "DELETE_SELECTED" }),
    []
  );

  const toggleSelect = useCallback(
    (id: string, additive: boolean) => {
      dispatch({ type: "TOGGLE_SELECT", id, additive });
      lastSelectRef.current = id;
    },
    []
  );

  const selectRange = useCallback(
    (toId: string) => {
      if (lastSelectRef.current) {
        dispatch({
          type: "SELECT_RANGE",
          fromId: lastSelectRef.current,
          toId,
        });
      }
    },
    []
  );

  const selectAll = useCallback(
    () => dispatch({ type: "SELECT_ALL" }),
    []
  );

  const deselectAll = useCallback(
    () => dispatch({ type: "DESELECT_ALL" }),
    []
  );

  // ── Drag ───────────────────────────────────────────────────────────

  const startDrag = useCallback(
    (segmentId: string, edge: DragEdge, startX: number) => {
      const seg = state.segments.find((s) => s.id === segmentId);
      if (!seg) return;
      dispatch({
        type: "DRAG_START",
        info: {
          segmentId,
          edge,
          startX,
          originalStart: seg.start,
          originalEnd: seg.end,
          originalSourceStart: seg.sourceStart ?? 0,
          originalSourceEnd: seg.sourceEnd ?? 0,
        },
      });
    },
    [state.segments]
  );

  const moveDrag = useCallback(
    (currentX: number) => dispatch({ type: "DRAG_MOVE", currentX }),
    []
  );

  const endDrag = useCallback(
    () => dispatch({ type: "DRAG_END" }),
    []
  );

  // ── Zoom ───────────────────────────────────────────────────────────

  const zoom = useCallback(
    (delta: number, anchorSec?: number) =>
      dispatch({ type: "ZOOM", delta, anchorSec }),
    []
  );

  const setZoom = useCallback(
    (pxPerSecond: number) =>
      dispatch({ type: "SET_ZOOM", pxPerSecond }),
    []
  );

  const setScroll = useCallback(
    (offsetSec: number) => dispatch({ type: "SET_SCROLL", offsetSec }),
    []
  );

  const zoomToFit = useCallback(
    (containerWidth: number) => {
      if (state.totalDuration <= 0 || containerWidth <= 0) return;
      // Leave a small 5% margin
      const targetPPS = (containerWidth * 0.95) / state.totalDuration;
      dispatch({ type: "SET_ZOOM", pxPerSecond: targetPPS });
      dispatch({ type: "SET_SCROLL", offsetSec: 0 });
    },
    [state.totalDuration]
  );

  // ── Direct edits ──────────────────────────────────────────────────

  const updateSegment = useCallback(
    (id: string, start: number, end: number) =>
      dispatch({ type: "UPDATE_SEGMENT", id, start, end }),
    []
  );

  const renameSegment = useCallback(
    (id: string, label: string) =>
      dispatch({ type: "RENAME_SEGMENT", id, label }),
    []
  );

  // ── Computed helpers ───────────────────────────────────────────────

  /** Convert seconds → pixel position relative to timeline origin. */
  const secToPx = useCallback(
    (sec: number) =>
      (sec - state.viewport.scrollOffsetSec) *
      state.viewport.zoom.pxPerSecond,
    [state.viewport]
  );

  /** Convert pixel position → seconds. */
  const pxToSec = useCallback(
    (px: number) =>
      px / state.viewport.zoom.pxPerSecond +
      state.viewport.scrollOffsetSec,
    [state.viewport]
  );

  return {
    state,
    dispatch,

    // lifecycle
    init,

    // playhead
    setPlayhead,

    // operations
    splitAtPlayhead,
    mergeSelected,
    deleteSelected,

    // selection
    toggleSelect,
    selectRange,
    selectAll,
    deselectAll,

    // drag
    startDrag,
    moveDrag,
    endDrag,

    // zoom / scroll
    zoom,
    setZoom,
    setScroll,
    zoomToFit,

    // direct edits
    updateSegment,
    renameSegment,

    // history
    undo,
    redo,

    // converters
    secToPx,
    pxToSec,
  };
}

export type UseTimelineReturn = ReturnType<typeof useTimeline>;
