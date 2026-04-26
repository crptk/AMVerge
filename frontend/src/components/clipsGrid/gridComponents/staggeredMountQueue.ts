/**
 * staggeredMountQueue.ts
 *
 * Custom React hook for mounting video tiles one at a time in grid preview mode.
 * Prevents browser/GPU stalls by deferring video element creation.
 */
import { useRef, useCallback } from "react";

type StaggerDemand = {
  order: number; // Lower = higher priority (top-left first)
  onReady: () => void; // Called when it's this tile's turn to mount
};


export function useStaggeredMountQueue(delayMs = 50) {
  // Tracks which tiles want to mount and their order
  const demandRef = useRef<Map<string, StaggerDemand>>(new Map());
  // Interval for ticking through the queue
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Prevents multiple schedules
  const startScheduledRef = useRef(false);

  // Processes one tile per tick (lowest order first)
  const tick = useCallback(() => {
    if (demandRef.current.size === 0) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    let bestKey: string | null = null;
    let bestOrder = Infinity;
    for (const [key, entry] of demandRef.current) {
      if (entry.order < bestOrder) {
        bestOrder = entry.order;
        bestKey = key;
      }
    }
    if (!bestKey) return;

    const entry = demandRef.current.get(bestKey)!;
    demandRef.current.delete(bestKey);
    entry.onReady();
  }, []);

  // Starts the interval for processing the queue
  const startProcessing = useCallback(() => {
    startScheduledRef.current = false;
    if (intervalRef.current !== null) return;
    if (demandRef.current.size === 0) return;

    tick();
    if (demandRef.current.size > 0) {
      intervalRef.current = setInterval(tick, delayMs);
    }
  }, [tick, delayMs]);

  // Schedules the start of processing (defers to next macrotask)
  const scheduleStart = useCallback(() => {
    if (startScheduledRef.current || intervalRef.current !== null) return;
    startScheduledRef.current = true;
    setTimeout(startProcessing, 0);
  }, [startProcessing]);

  // Tiles call this to register/unregister their demand to mount
  const reportStaggerDemand = useCallback(
    (key: string, demand: StaggerDemand | null) => {
      if (!demand) {
        demandRef.current.delete(key);
        if (demandRef.current.size === 0 && intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      demandRef.current.set(key, demand);
      scheduleStart();
    },
    [scheduleStart]
  );

  return { reportStaggerDemand };
}