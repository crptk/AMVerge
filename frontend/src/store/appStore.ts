import { ClipItem, EpisodeEntry, EpisodeFolder } from "../types/domain";
import { create } from "zustand";

export type AppState = {
  focusedClip: string | null;
  selectedClips: Set<string>;
  clips: ClipItem[];
  episodes: EpisodeEntry[];
  selectedEpisodeId: string | null;
  episodeFolders: EpisodeFolder[];
  openedEpisodeId: string | null;
  selectedFolderId: string | null;
  importedVideoPath: string | null;
  videoIsHEVC: boolean | null;
};

export type AppStateStore = AppState & {
  setFocusedClip: (clip: string | null) => void;
  setSelectedClips: (
    clips: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => void;
  setClips: (
    clips: ClipItem[] | ((prev: ClipItem[]) => ClipItem[])
  ) => void;
  setEpisodes: (
    episodes: EpisodeEntry[] | ((prev: EpisodeEntry[]) => EpisodeEntry[])
  ) => void;
  setSelectedEpisodeId: (episodeId: string | null) => void;
  setEpisodeFolders: (
    episodeFolders: EpisodeFolder[] | ((prev: EpisodeFolder[]) => EpisodeFolder[])
  ) => void;
  setOpenedEpisodeId: (episodeId: string | null) => void;
  setSelectedFolderId: (folderId: string | null) => void;
  setImportedVideoPath: (videoPath: string | null) => void;
  setVideoIsHEVC: (isHEVC: boolean | null) => void;
  resetAppState: () => void;
};

export const DEFAULT_APP_STATE: AppState = {
  focusedClip: null,
  selectedClips: new Set(),
  clips: [],
  episodes: [],
  selectedEpisodeId: null,
  episodeFolders: [],
  openedEpisodeId: null,
  selectedFolderId: null,
  importedVideoPath: null,
  videoIsHEVC: null,
}

export const useAppStateStore = create<AppStateStore>()((set) => ({
  ...DEFAULT_APP_STATE,

  setFocusedClip: (focusedClip) => set({ focusedClip }),
  setSelectedClips: (clips) =>
    set((state) => ({
      selectedClips:
        typeof clips === "function"
          ? clips(state.selectedClips)
          : clips,
    })),
  setClips: (clips) =>
    set((state) => ({
      clips:
      typeof clips === "function"
        ? clips(state.clips)
        : clips,
    })),
  setEpisodes: (episodes) => 
    set((state) => ({
      episodes:
          typeof episodes === "function"
          ? episodes(state.episodes)
          : episodes,
    })),
  setSelectedEpisodeId: (selectedEpisodeId) => set({ selectedEpisodeId }),
  setEpisodeFolders: (episodeFolders) =>
    set((state) => ({
      episodeFolders:
      typeof episodeFolders === "function"
        ? episodeFolders(state.episodeFolders)
          : episodeFolders,
    })),
  setOpenedEpisodeId: (openedEpisodeId) => set({ openedEpisodeId }),
  setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),
  setImportedVideoPath: (importedVideoPath) => set({ importedVideoPath }),
  setVideoIsHEVC: (videoIsHEVC) => set({ videoIsHEVC }),

  resetAppState: () =>
    set({
      ...DEFAULT_APP_STATE,
      selectedClips: new Set(),
    }),
}));