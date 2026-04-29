import React, { memo } from "react";

type Props = {
  leftPx: number;
  height: number;
  onPointerDown: (e: React.PointerEvent) => void;
};

/**
 * The vertical playhead scrubber.
 *
 * Visual structure:
 *   ▼  ← head (draggable triangle)
 *   │
 *   │  ← stem (vertical line through track)
 */
function TimelinePlayhead({ leftPx, height, onPointerDown }: Props) {
  return (
    <div
      className="tl-playhead"
      id="timeline-playhead"
      style={{ left: leftPx }}
      onPointerDown={onPointerDown}
    >
      {/* Triangle head */}
      <div className="tl-playhead-head" />

      {/* Vertical line */}
      <div
        className="tl-playhead-stem"
        style={{ height: height + 24 }}
      />
    </div>
  );
}

export default memo(TimelinePlayhead);
