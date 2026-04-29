// ─── Timeline Domain Types ───────────────────────────────────────────
// Pure data types for the CapCut-style timeline.
// Nothing here imports React — keep it portable.

import { ClipItem } from "./domain";

/** A single segment on the timeline (one "clip region"). */
export type TimelineSegment = {
  id: string;
  /** Start time in **seconds** (floating-point for frame accuracy). */
  start: number;
  /** End time in **seconds**. */
  end: number;
  /** Optional label shown on the segment chip. */
  label?: string;
  /** Optional colour override (CSS value). Falls back to accent. */
  color?: string;
  /** Reference to the original clip to maintain src/thumbnail during edits */
  sourceClip?: ClipItem;
  /** Reference to all clips combined in a merge, to allow playlist previews */
  sourceClips?: ClipItem[];
  /** The actual start time in the source video file */
  sourceStart?: number;
  /** The actual end time in the source video file */
  sourceEnd?: number;
  /** Whether the backend is currently merging or splitting this segment */
  isProcessing?: boolean;
  /** Info about a pending split operation */
  splitInfo?: {
    originalId: string;
    part: 1 | 2;
    splitTime: number;
    inputPath: string;
  };
};

/** Which edge the user is dragging. */
export type DragEdge = "left" | "right" | "body";

/** Info attached to an active drag operation. */
export type DragInfo = {
  segmentId: string;
  edge: DragEdge;
  /** The pointer-x at drag start (px). */
  startX: number;
  /** Segment snapshot at drag start so deltas are relative. */
  originalStart: number;
  originalEnd: number;
  /** Source-file timestamps at drag start (avoids drift on repeated DRAG_MOVE). */
  originalSourceStart: number;
  originalSourceEnd: number;
};

/** Zoom level for the timeline. */
export type TimelineZoom = {
  /** Pixels per second of video. Higher = more zoomed in. */
  pxPerSecond: number;
};

/** Scroll + zoom viewport state. */
export type TimelineViewport = {
  /** Horizontal scroll offset in seconds. */
  scrollOffsetSec: number;
  zoom: TimelineZoom;
};

/** Undo/redo history stack. */
export type TimelineHistory = {
  past: TimelineSegment[][];
  future: TimelineSegment[][];
};

/** The full state blob managed by useTimeline. */
export type TimelineState = {
  segments: TimelineSegment[];
  /** Total duration of the source video in seconds. */
  totalDuration: number;
  /** Current playhead position in seconds. */
  playheadSec: number;
  /** Currently selected segment IDs (for multi-select merge). */
  selectedIds: Set<string>;
  viewport: TimelineViewport;
  /** Active drag — null when idle. */
  drag: DragInfo | null;
  /** Undo/redo history. */
  history: TimelineHistory;
};
