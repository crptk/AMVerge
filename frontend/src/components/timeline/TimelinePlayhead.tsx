import React, { memo } from "react";

type Props = {
  leftPx: number;
  height: number;
  timecode?: string;
  onPointerDown: (e: React.PointerEvent) => void;
};

/**
 * The vertical playhead scrubber — CapCut-style pill handle + thin stem.
 *
 * Visual structure:
 *   ┌──┐  ← pill handle (draggable)
 *   │  │
 *   └──┘
 *    │   ← stem (vertical line through track)
 */
function TimelinePlayhead({ leftPx, height, timecode, onPointerDown }: Props) {
  return (
    <div
      className="tl-playhead"
      id="timeline-playhead"
      style={{ left: leftPx }}
      onPointerDown={onPointerDown}
    >
      {/* Pill-shaped handle */}
      <div className="tl-playhead-head">
        {timecode && <span className="tl-playhead-timecode">{timecode}</span>}
      </div>

      {/* Vertical line */}
      <div
        className="tl-playhead-stem"
        style={{ height: height + 24 }}
      />
    </div>
  );
}

export default memo(TimelinePlayhead);
