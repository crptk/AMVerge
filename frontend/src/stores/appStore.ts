import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ClipItem } from "../types/domain";

type SetterValue<T> = T | ((prev: T) => T);

function resolveSetterValue<T>(prev: T, value: SetterValue<T>): T {
  return typeof value === "function" ? (value as (current: T) => T)(prev) : value;
}

export type AppState = {
  // App core state
  focusedClip: string | null;
  selectedClips: Set<string>;
  clips: ClipItem[];
  videoIsHEVC: boolean | null;
  userHasHEVC: boolean;
  importedVideoPath: string | null;
  timelineClipIds: Set<string>;
  
  // App loading and progress state
  loading: boolean;
  progress: number;
  progressMsg: string;
  importToken: string;
  batchTotal: number;
  batchDone: number;
  batchCurrentFile: string | null;
  showLoaderCancel: boolean;
  loaderCancelLabel: string;
};

export type AppStateStore = AppState & {
  setFocusedClip: (clip: SetterValue<string | null>) => void;
  setSelectedClips: (clips: SetterValue<Set<string>>) => void;
  setClips: (clips: SetterValue<ClipItem[]>) => void;
  setVideoIsHEVC: (isHEVC: SetterValue<boolean | null>) => void;
  setUserHasHEVC: (hasHEVC: boolean) => void;
  setImportedVideoPath: (path: SetterValue<string | null>) => void;
  setTimelineClipIds: (ids: SetterValue<Set<string>>) => void;
  
  setLoading: (loading: boolean) => void;
  setProgress: (progress: number) => void;
  setProgressMsg: (msg: string) => void;
  setImportToken: (token: SetterValue<string>) => void;
  setBatchTotal: (total: SetterValue<number>) => void;
  setBatchDone: (done: SetterValue<number>) => void;
  setBatchCurrentFile: (file: SetterValue<string | null>) => void;
  setShowLoaderCancel: (show: boolean) => void;
  setLoaderCancelLabel: (label: string) => void;
};

export const DEFAULT_APP_STATE: AppState = {
  focusedClip: null,
  selectedClips: new Set(),
  clips: [],
  videoIsHEVC: null,
  userHasHEVC: false,
  importedVideoPath: null,
  timelineClipIds: new Set(),
  
  loading: false,
  progress: 0,
  progressMsg: "Starting...",
  importToken: "",
  batchTotal: 0,
  batchDone: 0,
  batchCurrentFile: null,
  showLoaderCancel: false,
  loaderCancelLabel: "Cancel",
};

export const useAppStateStore = create<AppStateStore>()((set) => ({
  ...DEFAULT_APP_STATE,

  setFocusedClip: (val) => set((s) => ({ focusedClip: resolveSetterValue(s.focusedClip, val) })),
  setSelectedClips: (val) => set((s) => ({ selectedClips: resolveSetterValue(s.selectedClips, val) })),
  setClips: (val) => set((s) => ({ clips: resolveSetterValue(s.clips, val) })),
  setVideoIsHEVC: (val) => set((s) => ({ videoIsHEVC: resolveSetterValue(s.videoIsHEVC, val) })),
  setUserHasHEVC: (hasHEVC) => set({ userHasHEVC: hasHEVC }),
  setImportedVideoPath: (val) => set((s) => ({ importedVideoPath: resolveSetterValue(s.importedVideoPath, val) })),
  setTimelineClipIds: (val) => set((s) => ({ timelineClipIds: resolveSetterValue(s.timelineClipIds, val) })),
  
  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setProgressMsg: (progressMsg) => set({ progressMsg }),
  setImportToken: (val) => set((s) => ({ importToken: resolveSetterValue(s.importToken, val) })),
  setBatchTotal: (val) => set((s) => ({ batchTotal: resolveSetterValue(s.batchTotal, val) })),
  setBatchDone: (val) => set((s) => ({ batchDone: resolveSetterValue(s.batchDone, val) })),
  setBatchCurrentFile: (val) => set((s) => ({ batchCurrentFile: resolveSetterValue(s.batchCurrentFile, val) })),
  setShowLoaderCancel: (showLoaderCancel) => set({ showLoaderCancel }),
  setLoaderCancelLabel: (loaderCancelLabel) => set({ loaderCancelLabel }),
}));

type AppPersistedState = {
  exportDir: string | null;
};

type AppPersistedStore = AppPersistedState & {
  setExportDir: (dir: SetterValue<string | null>) => void;
};

export const useAppPersistedStore = create<AppPersistedStore>()(
  persist(
    (set) => ({
      exportDir: null,
      setExportDir: (val) => set((s) => ({ exportDir: resolveSetterValue(s.exportDir, val) })),
    }),
    {
      name: "amverge_export_dir_v1",
    }
  )
);