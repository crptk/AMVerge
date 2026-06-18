import { create } from "zustand";

/**
 * Shared store for per-scene animated WebP previews, keyed by clip id.
 * Populated by the viewport-aware WebP queue (grid) and consumed by both the
 * clips grid tiles and the preview panel.
 */
export type ScenePreviewStore = {
  animatedByClipId: Record<string, string>;
  setAnimated: (clipId: string, path: string) => void;
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
  reset: () => set({ animatedByClipId: {} }),
}));
