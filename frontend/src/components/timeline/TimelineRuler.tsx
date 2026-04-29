import { memo, useMemo } from "react";
import type { TimelineViewport } from "../../types/timeline";

type Props = {
  totalDuration: number;
  viewport: TimelineViewport;
  secToPx: (sec: number) => number;
  onPointerDown?: (e: React.PointerEvent) => void;
};

/**
 * Time‐ruler showing tick marks + labels above the track.
 *
 * Adapts spacing dynamically based on zoom level so labels
 * never overlap. At high zoom, shows frame numbers.
 */
function TimelineRuler({ totalDuration, viewport, secToPx, onPointerDown }: Props) {
  const { pxPerSecond } = viewport.zoom;

  // Choose a tick interval that keeps labels ≈80-120 px apart
  const tickInterval = useMemo(() => {
    const candidates = [
      0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120,
      300, 600,
    ];
    const targetPxGap = 100;
    for (const c of candidates) {
      if (c * pxPerSecond >= targetPxGap) return c;
    }
    return 600;
  }, [pxPerSecond]);

  // High zoom = show frame-level labels
  const showFrames = tickInterval < 0.1;

  // Generate tick positions
  const ticks = useMemo(() => {
    const result: { sec: number; px: number; major: boolean }[] = [];
    const start =
      Math.floor(viewport.scrollOffsetSec / tickInterval) * tickInterval;
    // Render extra ticks beyond visible area for smooth scrolling
    const end = Math.min(
      totalDuration,
      viewport.scrollOffsetSec + 4000 / pxPerSecond
    );

    for (let t = start; t <= end; t += tickInterval) {
      if (t < 0) continue;
      const major = tickInterval >= 1
        ? t % (tickInterval * 5 < 60 ? tickInterval * 5 : tickInterval) === 0
        : true;
      result.push({
        sec: t,
        px: secToPx(t),
        major,
      });
    }
    return result;
  }, [totalDuration, viewport.scrollOffsetSec, pxPerSecond, tickInterval, secToPx]);

  return (
    <div className="tl-ruler" id="timeline-ruler" onPointerDown={onPointerDown}>
      <div
        className="tl-ruler-inner"
        style={{ width: totalDuration * pxPerSecond }}
      >
        {ticks.map((tick) => (
          <div
            key={tick.sec}
            className={`tl-ruler-tick ${tick.major ? "tl-ruler-tick--major" : ""}`}
            style={{ left: tick.px }}
          >
            <span className="tl-ruler-label">
              {showFrames ? formatFrameLabel(tick.sec) : formatRulerLabel(tick.sec)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(TimelineRuler);

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRulerLabel(sec: number): string {
  if (sec < 0.01) return "0";
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s.toFixed(sec % 1 !== 0 ? 1 : 0)}s`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}

function formatFrameLabel(sec: number): string {
  const frames = Math.round(sec * 30); // 30fps
  const wholeSec = Math.floor(sec);
  const frameInSec = frames - wholeSec * 30;
  if (wholeSec === 0) return `${frameInSec}f`;
  return `${wholeSec}s${frameInSec}f`;
}
