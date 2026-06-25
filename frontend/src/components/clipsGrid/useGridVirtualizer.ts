/**
 * useGridVirtualizer.ts
 *
 * Row-based windowing for the clips grid. The grid is uniform (every tile shares
 * the same width/aspect), so we only need a single measured row height to know
 * exactly where every row lands. We render just the visible slice of clips inside
 * one absolutely-positioned grid, offset to the first visible row, sitting in a
 * full-height spacer so the scrollbar still reflects the whole list.
 *
 * The row height is MEASURED from a live tile rather than computed, so it stays
 * correct across window resizes, column-count changes, the per-tile aspect-ratio
 * setting, and browser zoom — without re-deriving the CSS math here.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Must match .clips-grid `gap` and `padding` in styles/home/clipsGrid.css.
const GRID_GAP = 15;
const GRID_PADDING = 15;
// Extra rows rendered above/below the viewport so fast scrolling never reveals a
// blank gap before the next row mounts.
const OVERSCAN_ROWS = 2;
// Pre-measurement fallback used for the very first render only; corrected by the
// layout-effect measurement before the browser paints, so it never flashes.
const ESTIMATED_ROW_HEIGHT = 220;

// Tiles within the window are revealed incrementally (top-left → bottom-right)
// rather than all at once, so expanding the grid or loading a big window cascades
// in over a few frames instead of freezing on one giant mount. The per-frame
// batch scales with the backlog so the cascade always completes in roughly
// MAX_RAMP_FRAMES frames — snappy for small additions, still smooth for huge ones.
const REVEAL_BASE_BATCH = 3;
const MAX_RAMP_FRAMES = 12;

export type GridWindow = {
  /** First clip index to render (inclusive). */
  startIndex: number;
  /** Last clip index to render (exclusive). */
  endIndex: number;
  /** translateY applied to the rendered grid so the slice lines up with its rows. */
  offsetY: number;
  /** Height of the full-list spacer that drives the scrollbar. */
  totalHeight: number;
};

type Params = {
  containerRef: React.RefObject<HTMLElement | null>;
  columns: number;
  itemCount: number;
  /** Disable windowing (e.g. while the loading skeleton is shown). */
  enabled: boolean;
};

export function useGridVirtualizer({ containerRef, columns, itemCount, enabled }: Params): GridWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);
  // How many tiles (counting from the window's first index) are currently allowed
  // to mount. Ramps up toward the full window so reveals cascade in.
  const [revealed, setRevealed] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Read the live viewport height and a real tile's height from the DOM.
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const vh = el.clientHeight;
    setViewportHeight((prev) => (prev !== vh ? vh : prev));
    const tile = el.querySelector<HTMLElement>(".clip-wrapper");
    if (tile) {
      const h = tile.getBoundingClientRect().height;
      if (h > 0) setRowHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
    }
  }, [containerRef]);

  // Track scroll position, coalesced to one update per animation frame.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [containerRef]);

  // Re-measure on any container size change (window resize, panel layout, zoom).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, measure]);

  // Re-measure synchronously (before paint) when inputs that change tile size do:
  // column count, item presence, or enable toggling.
  useLayoutEffect(() => {
    measure();
  }, [measure, columns, itemCount, enabled]);

  const active = enabled && itemCount > 0;

  const cols = Math.max(1, columns);
  const rowStride = rowHeight + GRID_GAP;
  const totalRows = active ? Math.ceil(itemCount / cols) : 0;
  // GRID_PADDING folds in the top inset; the trailing row's stride leaves an
  // equal bottom inset, so the list keeps its original 15px padding on both ends.
  const totalHeight = active ? GRID_PADDING + totalRows * rowStride : 0;

  const rowsInView = Math.ceil((viewportHeight || rowStride) / rowStride) + OVERSCAN_ROWS * 2 + 1;
  // Clamp the window into range so a stale scrollTop (e.g. the instant before the
  // scroll-to-top fires on an episode switch) can never produce an empty slice.
  const maxFirstRow = Math.max(0, totalRows - rowsInView);
  const firstRowRaw = Math.floor((scrollTop - GRID_PADDING) / rowStride) - OVERSCAN_ROWS;
  const firstRow = active ? Math.min(Math.max(0, firstRowRaw), maxFirstRow) : 0;
  const lastRow = active ? Math.min(totalRows, firstRow + rowsInView) : 0;

  const startIndex = firstRow * cols;
  const windowEndIndex = active ? Math.min(itemCount, lastRow * cols) : 0;
  // How many tiles the window *wants* shown; `revealed` chases this each frame.
  const targetCount = windowEndIndex - startIndex;

  // Ramp `revealed` toward `targetCount`, one batch per animation frame, so a big
  // jump (grid expand, fresh load) cascades in instead of mounting all at once.
  // Shrinking (scroll, fewer columns, disable) snaps down immediately — there's
  // nothing to stagger when removing tiles.
  useEffect(() => {
    if (revealed === targetCount) return;
    if (revealed > targetCount) {
      setRevealed(targetCount);
      return;
    }
    const remaining = targetCount - revealed;
    const batch = Math.max(REVEAL_BASE_BATCH, Math.ceil(remaining / MAX_RAMP_FRAMES));
    const id = requestAnimationFrame(() => {
      setRevealed((prev) => Math.min(targetCount, prev + batch));
    });
    return () => cancelAnimationFrame(id);
  }, [revealed, targetCount]);

  // Always show at least the first batch immediately so there's never a blank
  // frame between the loading skeleton clearing and the cascade starting.
  const minReveal = targetCount > 0 ? Math.min(targetCount, REVEAL_BASE_BATCH) : 0;
  const revealedCount = Math.min(targetCount, Math.max(revealed, minReveal));

  return {
    startIndex,
    endIndex: startIndex + revealedCount,
    offsetY: active ? GRID_PADDING + firstRow * rowStride : 0,
    totalHeight,
  };
}
