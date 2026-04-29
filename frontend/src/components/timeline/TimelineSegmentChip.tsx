import React, { memo, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { TimelineSegment, DragEdge } from "../../types/timeline";
import useFilmstrip from "../../hooks/useFilmstrip";

type Props = {
  segment: TimelineSegment;
  isSelected: boolean;
  isDragging: boolean;
  left: number;
  width: number;
  height: number;
  onPointerDown: (
    e: React.PointerEvent,
    segmentId: string,
    edge: DragEdge
  ) => void;
};

const HANDLE_WIDTH = 8;

/**
 * A single segment "chip" rendered inside the timeline track.
 *
 *  ┌┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓├┐
 *   │ left handle  body  right handle │
 *
 * The body now shows a filmstrip of evenly-spaced frames from the source
 * video, rendered via a single horizontal sprite sheet.
 * Width is proportional to duration (via parent's secToPx).
 */
function TimelineSegmentChip({
  segment,
  isSelected,
  isDragging,
  left,
  width,
  height,
  onPointerDown,
}: Props) {
  const duration = segment.end - segment.start;
  const showLabel = width > 48;
  const showDuration = width > 100;

  // Build the accent colour (supports per-segment overrides)
  const accentColor = segment.color ?? "var(--accent)";
  const accentRgb = segment.color ?? "var(--accent-rgb)";

  // ── Filmstrip sprite sheet ────────────────────────────────────────
  const videoPath = segment.sourceClip?.src;
  const clipDuration =
    segment.sourceClip?.end !== undefined && segment.sourceClip?.start !== undefined
      ? segment.sourceClip.end - segment.sourceClip.start
      : duration;

  const bodyWidth = Math.max(width - HANDLE_WIDTH * 2, 0);

  const filmstrip = useFilmstrip(
    videoPath,
    clipDuration > 0 ? clipDuration : duration,
    bodyWidth
  );

  // Calculate timeline scaling
  const pxPerSec = width / duration;

  // ── Compute filmstrip background styles ────────────────────────────
  const filmstripStyle = useMemo(() => {
    if (!filmstrip.spriteUrl) return undefined;

    // The sprite sheet represents the ENTIRE clipDuration.
    // We scale the background to fit the full clip width in the timeline.
    const fullClipWidth = clipDuration * pxPerSec;
    const offsetX = -(segment.sourceStart ?? 0) * pxPerSec;

    return {
      backgroundImage: `url(${filmstrip.spriteUrl})`,
      backgroundSize: `${fullClipWidth}px 100%`,
      backgroundRepeat: "no-repeat" as const,
      backgroundPosition: `${offsetX}px top`,
    };
  }, [filmstrip.spriteUrl, clipDuration, pxPerSec, segment.sourceStart]);

  // Fallback to single thumbnail if no filmstrip yet
  const fallbackStyle = useMemo(() => {
    if (filmstrip.spriteUrl || !segment.sourceClip?.thumbnail) return undefined;
    const offsetX = -(segment.sourceStart ?? 0) * pxPerSec;
    return {
      backgroundImage: `url(${convertFileSrc(segment.sourceClip.thumbnail)})`,
      backgroundSize: "auto 100%",
      backgroundRepeat: "repeat-x" as const,
      backgroundPosition: `${offsetX}px top`,
    };
  }, [filmstrip.spriteUrl, segment.sourceClip?.thumbnail, segment.sourceStart, pxPerSec]);

  return (
    <div
      className={[
        "tl-segment",
        isSelected && "tl-segment--selected",
        isDragging && "tl-segment--dragging",
      ]
        .filter(Boolean)
        .join(" ")}
      id={`tl-segment-${segment.id}`}
      style={{
        left,
        width: Math.max(width, 4), // never collapse to invisible
        height: height - 8, // 4px top + 4px bottom margin
        top: 4,
        "--seg-accent": accentColor,
        "--seg-accent-rgb": accentRgb,
      } as React.CSSProperties}
    >
      {/* Left resize handle */}
      <div
        className="tl-segment-handle tl-segment-handle--left"
        style={{ width: HANDLE_WIDTH }}
        onPointerDown={(e) => onPointerDown(e, segment.id, "left")}
      />

      {/* Body */}
      <div
        className="tl-segment-body"
        onPointerDown={(e) => onPointerDown(e, segment.id, "body")}
      >
        {/* Filmstrip background layer */}
        <div
          className={`tl-segment-filmstrip ${filmstrip.spriteUrl ? "tl-segment-filmstrip--sprite" : ""}`}
          style={filmstripStyle ?? fallbackStyle}
        />

        {showLabel && (
          <span className="tl-segment-label">
            {segment.label ?? segment.id.slice(0, 8)}
          </span>
        )}
        {showDuration && (
          <span className="tl-segment-duration">
            {formatDuration(duration)}
          </span>
        )}
      </div>

      {/* Right resize handle */}
      <div
        className="tl-segment-handle tl-segment-handle--right"
        style={{ width: HANDLE_WIDTH }}
        onPointerDown={(e) => onPointerDown(e, segment.id, "right")}
      />
    </div>
  );
}

export default memo(TimelineSegmentChip);

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
