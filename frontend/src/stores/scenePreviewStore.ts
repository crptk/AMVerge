import { create } from "zustand";

/**
 * Shared store for per-scene animated WebP previews, keyed by clip id.
 * Populated by the viewport-aware WebP queue (grid) and consumed by both the
 * clips grid tiles and the preview panel.
 */
export type ScenePreviewStore = {
  animatedByClipId: Record<string, string>;
  setAnimated: (clipId: string, path: string) => void;
  /**
   * Merge many clip→path entries in a single update. Used by the disk-cache
   * prime so a freshly opened episode publishes a whole chunk of results in one
   * commit (one O(n) copy, one render pass) instead of N spread/render cycles.
   */
  setAnimatedMany: (entries: Array<[string, string]>) => void;
  reset: () => void;
};

export const useScenePreviewStore = create<ScenePreviewStore>((set) => ({
  animatedByClipId: {},
  setAnimated: (clipId, path) =>
    set((s) =>
      s.animatedByClipId[clipId] === path
        ? s
        : { animatedByClipId: { ...s.animatedByClipId, [clipId]: path } }
    ),
  setAnimatedMany: (entries) =>
    set((s) => {
      let next = s.animatedByClipId;
      let changed = false;
      for (const [clipId, path] of entries) {
        if (next[clipId] === path) continue;
        if (!changed) {
          next = { ...s.animatedByClipId };
          changed = true;
        }
        next[clipId] = path;
      }
      return changed ? { animatedByClipId: next } : s;
    }),
  reset: () => set({ animatedByClipId: {} }),
}));
