import { create } from "zustand";

/**
 * Tracks WebP scene-preview generation progress for the background progress bar.
 * Updated by the viewport-aware WebP queue; consumed by App's BgProgressBar.
 *
 * `total`/`done` are cumulative for the current loading burst: each newly
 * demanded preview that needs backend work bumps `total`, each finished one
 * bumps `done`. When the queue fully drains (or the episode switches) both reset
 * to 0 so the bar hides and the next burst starts a fresh count.
 *
 * Kept in its own store so these frequent counter updates only re-render the
 * progress bar, never the clips grid (which slices `scenePreviewStore`).
 */
export type WebpLoadingStore = {
  total: number;
  done: number;
  setProgress: (total: number, done: number) => void;
  reset: () => void;
};

export const useWebpLoadingStore = create<WebpLoadingStore>((set) => ({
  total: 0,
  done: 0,
  setProgress: (total, done) =>
    set((s) => (s.total === total && s.done === done ? s : { total, done })),
  reset: () => set((s) => (s.total === 0 && s.done === 0 ? s : { total: 0, done: 0 })),
}));
