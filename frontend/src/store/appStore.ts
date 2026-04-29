import { ClipItem, EpisodeEntry, EpisodeFolder } from "../types/domain";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppState = {
  focusedClip: string | null;
  selectedClips: Set<string>;
  clips: ClipItem[];
  importedVideoPath: string | null;
  videoIsHEVC: boolean | null;
  loading: boolean;
  progress: number;
  progressMsg: string;
  importToken: string;
};

export type AppStateStore = AppState & {
  setFocusedClip: (clip: string | null) => void;
  setSelectedClips: (
    clips: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => void;
  setClips: (
    clips: ClipItem[] | ((prev: ClipItem[]) => ClipItem[])
  ) => void;
  setImportedVideoPath: (videoPath: string | null) => void;
  setVideoIsHEVC: (isHEVC: boolean | null) => void;

  setLoading: (loading: boolean) => void;
  setProgress: (progress: number) => void;
  setProgressMsg: (progressMsg: string) => void;
  setImportToken: (importToken: string) => void;

  resetAppState: () => void;
};

export const DEFAULT_APP_STATE: AppState = {
  focusedClip: null,
  selectedClips: new Set(),
  clips: [],
  importedVideoPath: null,
  videoIsHEVC: null,
  loading: false,
  progress: 0,
  progressMsg: "",
  importToken: "",
};

export const useAppStateStore = create<AppStateStore>()((set) => ({
  ...DEFAULT_APP_STATE,

  setFocusedClip: (focusedClip) => set({ focusedClip }),

  setSelectedClips: (clips) =>
    set((state) => ({
      selectedClips:
        typeof clips === "function" ? clips(state.selectedClips) : clips,
    })),

  setClips: (clips) =>
    set((state) => ({
      clips: typeof clips === "function" ? clips(state.clips) : clips,
    })),
  setImportedVideoPath: (importedVideoPath) => set({ importedVideoPath }),
  setVideoIsHEVC: (videoIsHEVC) => set({ videoIsHEVC }),

  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setProgressMsg: (progressMsg) => set({ progressMsg }),
  setImportToken: (importToken) => set({ importToken }),

  resetAppState: () =>
    set({
      ...DEFAULT_APP_STATE,
      selectedClips: new Set(),
    }),
}));