import React, { memo, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { TimelineSegment, DragEdge } from "../../types/timeline";
import useFilmstrip from "../../hooks/useFilmstrip";
import useHighPrecisionFilmstrip from "../../hooks/useHighPrecisionFilmstrip";

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

const HANDLE_WIDTH = 6;

/**
 * A single segment "chip" rendered inside the timeline track.
 * CapCut-style layout:
 *
 *  ┌────────────────────────────────────────┐
 *  │ filename.mp4   00:00:00:22            │  ← header bar
 *  ├────────────────────────────────────────┤
 *  │ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐ │  ← filmstrip
 *  │ │  ││  ││  ││  ││  ││  ││  ││  ││  │ │
 *  │ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘ │
 *  ├────────────────────────────────────────┤
 *  │ · · · · · · · · · · · · · · · · · ·  │  ← progress strip
 *  └────────────────────────────────────────┘
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
  const showLabel = width > 40;
  const showDuration = width > 90;
 
   const videoPath = segment.sourceClip?.src;
   const bodyWidth = Math.max(width - HANDLE_WIDTH * 2, 0);

   // Legacy fallback hook
   const clipDuration =
    segment.sourceClip?.end !== undefined && segment.sourceClip?.start !== undefined
      ? segment.sourceClip.end - segment.sourceClip.start
      : duration;

   const filmstrip = useFilmstrip(
    videoPath,
    clipDuration > 0 ? clipDuration : duration,
    bodyWidth,
    segment.sourceStart,
    segment.sourceEnd
  );

  const pxPerSec = width / duration;
  const filmstripStyle = useMemo(() => {
    if (!filmstrip.spriteUrl) return undefined;
    const fullClipWidth = clipDuration * pxPerSec;
    const offsetX = -(segment.sourceStart ?? 0) * pxPerSec;
    return {
      backgroundImage: `url(${filmstrip.spriteUrl})`,
      backgroundSize: `${fullClipWidth}px 100%`,
      backgroundRepeat: "no-repeat" as const,
      backgroundPosition: `${offsetX}px top`,
    };
  }, [filmstrip.spriteUrl, clipDuration, pxPerSec, segment.sourceStart]);

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

  // ── High Precision Filmstrip ──────────────────────────────────────
  const hpFilmstrip = useHighPrecisionFilmstrip(videoPath, segment.sourceClip?.id);
  
  const frameTiles = useMemo(() => {
    if (!hpFilmstrip || !hpFilmstrip.cachePath) return [];
    
    const { fps, cachePath } = hpFilmstrip;
    const sStart = segment.sourceStart ?? 0;
    const sEnd = segment.sourceEnd ?? duration;
    const sDur = sEnd - sStart;
    
    const tileWidth = 80; // pixels per thumbnail tile
    const numTiles = Math.max(1, Math.ceil(bodyWidth / tileWidth));
    
    const tiles = [];
    for (let i = 0; i < numTiles; i++) {
        const timeOffset = (i / numTiles) * sDur;
        const frameTime = sStart + timeOffset;
        const frameIdx = Math.max(1, Math.floor(frameTime * fps) + 1);
        const frameName = `frame_${String(frameIdx).padStart(6, '0')}.png`;
        
        const fullPath = `${cachePath}/${frameName}`;
        const url = convertFileSrc(fullPath);
        
        tiles.push({
            url,
            id: `${segment.id}-tile-${i}`
        });
    }
    return tiles;
  }, [hpFilmstrip, segment.id, segment.sourceStart, segment.sourceEnd, bodyWidth, duration]);

  return (
    <div
      className={[
        "tl-segment",
        isSelected && "tl-segment--selected",
        isDragging && "tl-segment--dragging",
        segment.isProcessing && "tl-segment--processing",
      ]
        .filter(Boolean)
        .join(" ")}
      id={`tl-segment-${segment.id}`}
      style={{
        left,
        width: Math.max(width, 4), // never collapse to invisible
        height: height - 8, // 4px top + 4px bottom margin
        top: 4,
      } as React.CSSProperties}
    >
      {/* Left resize handle */}
      <div
        className="tl-segment-handle tl-segment-handle--left"
        style={{ width: HANDLE_WIDTH }}
        onPointerDown={(e) => onPointerDown(e, segment.id, "left")}
      />

      {/* Main content area */}
      <div
        className="tl-segment-content"
        onPointerDown={(e) => onPointerDown(e, segment.id, "body")}
      >
        {/* Header bar with filename + timecode */}
        <div className="tl-segment-header">
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

        {/* Filmstrip body */}
        <div className="tl-segment-body">
            {frameTiles.length > 0 ? (
                <div className="tl-frame-container">
                    {frameTiles.map(tile => (
                        <div 
                            key={tile.id} 
                            className="tl-frame-tile"
                            style={{ backgroundImage: `url(${tile.url})` }}
                        />
                    ))}
                </div>
            ) : (
                <div
                    className={`tl-segment-filmstrip ${filmstrip.spriteUrl ? "tl-segment-filmstrip--sprite" : ""} ${filmstrip.loading ? "tl-segment-filmstrip--loading" : ""}`}
                    style={filmstripStyle ?? fallbackStyle}
                />
            )}
        </div>

        {/* Bottom progress strip */}
        <div className="tl-segment-progress" />
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
