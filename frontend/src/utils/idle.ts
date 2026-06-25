/**
 * idle.ts
 *
 * requestIdleCallback with a setTimeout fallback for environments that lack it,
 * plus a matching cancel. Used to push non-urgent main-thread work (canvas
 * decode/encode, pixel sampling) out of scroll/interaction frames so a burst of
 * thumbnails arriving mid-scroll can't block input handling.
 */
export type IdleHandle = number;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function scheduleIdle(callback: () => void, timeout = 500): IdleHandle {
  if (typeof window !== "undefined") {
    const ric = (window as IdleWindow).requestIdleCallback;
    if (typeof ric === "function") {
      return ric.call(window, callback, { timeout });
    }
  }
  return window.setTimeout(callback, 1) as unknown as IdleHandle;
}

export function cancelIdle(handle: IdleHandle): void {
  if (typeof window !== "undefined") {
    const cic = (window as IdleWindow).cancelIdleCallback;
    if (typeof cic === "function") {
      cic.call(window, handle);
      return;
    }
  }
  window.clearTimeout(handle);
}
