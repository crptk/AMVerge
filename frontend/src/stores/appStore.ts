import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ClipItem } from "../types/domain";

type SetterValue<T> = T | ((prev: T) => T);

function resolveSetterValue<T>(prev: T, value: SetterValue<T>): T {
  return typeof value === "function" ? (value as (current: T) => T)(prev) : value;
}

/* =========================
      GENERAL APP STATES
   ========================= */
export type AppState = {
  // App core state
  focusedClip: string | null;
  selectedClips: Set<string>;
  clips: ClipItem[];
  videoIsHEVC: boolean | null;
  userHasHEVC: boolean;
  importedVideoPath: string | null;
  
  // App loading and progress state
  loading: boolean;
  progress: number;
  progressMsg: string;
  bgProgress: { done: number; total: number } | null;
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
  
  loading: false,
  progress: 0,
  progressMsg: "",
  bgProgress: null,
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
  dismissedNotificationIds: string[];
};

type AppPersistedStore = AppPersistedState & {
  setExportDir: (dir: SetterValue<string | null>) => void;
  dismissNotificationId: (notificationId: string) => void;
};

export const useAppPersistedStore = create<AppPersistedStore>()(
  persist(
    (set) => ({
      exportDir: null,
      dismissedNotificationIds: [],
      setExportDir: (val) => set((s) => ({ exportDir: resolveSetterValue(s.exportDir, val) })),
      dismissNotificationId: (notificationId) =>
        set((s) => {
          const id = notificationId.trim();
          if (!id || s.dismissedNotificationIds.includes(id)) {
            return s;
          }
          return { dismissedNotificationIds: [...s.dismissedNotificationIds, id] };
        }),
    }),
    {
      name: "amverge_export_dir_v1",
    }
  )
);