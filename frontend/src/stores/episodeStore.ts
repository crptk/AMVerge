import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EpisodeEntry, EpisodeFolder } from "../types/domain";

/* =========================
    EPISODE PANEL RUNTIME
   ========================= */
export type EpisodePanelRuntimeState = {
    episodes: EpisodeEntry[];
    selectedEpisodeId: string | null;
    selectedFolderId: string | null;
    openedEpisodeId: string | null;
    isHydratingEpisodes: boolean;
};

export type EpisodePanelRuntimeStore = EpisodePanelRuntimeState & {
    setEpisodes: (
        episodes: EpisodeEntry[] | ((prev: EpisodeEntry[]) => EpisodeEntry[])
    ) => void;

    setSelectedEpisodeId: (episodeId: string | null) => void;
    setSelectedFolderId: (folderId: string | null) => void;
    setOpenedEpisodeId: (episodeId: string | null) => void;
    setIsHydratingEpisodes: (value: boolean) => void;

    resetEpisodePanelRuntime: () => void;
};

export const DEFAULT_EPISODE_PANEL_RUNTIME_STATE: EpisodePanelRuntimeState = {
    episodes: [],
    selectedEpisodeId: null,
    selectedFolderId: null,
    openedEpisodeId: null,
    isHydratingEpisodes: false,
};

// Migrate old raw-format data to Zustand persist format
try {
    const _raw = localStorage.getItem("amverge_episode_panel_v1");
    if (_raw) {
        const _parsed = JSON.parse(_raw);
        if (_parsed && !_parsed.state && Array.isArray(_parsed.episodes)) {
            localStorage.setItem("amverge_episode_panel_v1", JSON.stringify({
                state: { episodes: _parsed.episodes },
                version: 0,
            }));
        }
    }
} catch { /* ignore */ }

export const useEpisodePanelRuntimeStore = create<EpisodePanelRuntimeStore>()(
    persist(
        (set) => ({
            ...DEFAULT_EPISODE_PANEL_RUNTIME_STATE,

            setEpisodes: (episodes) =>
                set((state) => ({
                    episodes:
                        typeof episodes === "function"
                            ? episodes(state.episodes)
                            : episodes,
                })),

            setSelectedEpisodeId: (selectedEpisodeId) => set({ selectedEpisodeId }),
            setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),
            setOpenedEpisodeId: (openedEpisodeId) => set({ openedEpisodeId }),
            setIsHydratingEpisodes: (isHydratingEpisodes) =>
                set({ isHydratingEpisodes }),

            resetEpisodePanelRuntime: () =>
                set({ ...DEFAULT_EPISODE_PANEL_RUNTIME_STATE }),
        }),
        {
            name: "amverge_episode_panel_v1",
            partialize: (state) => ({ episodes: state.episodes }),
        }
    )
);

/* =========================
    EPISODE PANEL METADATA
   ========================= */
export type EpisodePanelMetadataState = {
    episodeFolders: EpisodeFolder[];
    episodeNamesById: Record<string, string>;
    episodeFolderById: Record<string, string | null>;
    lastOpenedEpisodeId: string | null;
};

export type EpisodePanelMetadataStore = EpisodePanelMetadataState & {
    setEpisodeFolders: (
        episodeFolders:
            | EpisodeFolder[]
            | ((prev: EpisodeFolder[]) => EpisodeFolder[])
    ) => void;

    setEpisodeName: (episodeId: string, displayName: string) => void;
    removeEpisodeName: (episodeId: string) => void;

    setEpisodeFolderId: (episodeId: string, folderId: string | null) => void;
    removeEpisodeFolderId: (episodeId: string) => void;

    removeEpisodeMetadata: (episodeId: string) => void;
    resetEpisodePanelMetadata: () => void;

    setLastOpenedEpisodeId: (episodeId: string | null) => void;
};

export const DEFAULT_EPISODE_PANEL_METADATA_STATE: EpisodePanelMetadataState = {
    episodeFolders: [],
    episodeNamesById: {},
    episodeFolderById: {},
    lastOpenedEpisodeId: null,
};

export const useEpisodePanelMetadataStore = create<EpisodePanelMetadataStore>()(
    persist(
        (set) => ({
            ...DEFAULT_EPISODE_PANEL_METADATA_STATE,

            setEpisodeFolders: (episodeFolders) =>
                set((state) => ({
                    episodeFolders:
                        typeof episodeFolders === "function"
                            ? episodeFolders(state.episodeFolders)
                            : episodeFolders,
                })),

            setEpisodeName: (episodeId, displayName) =>
                set((state) => ({
                    episodeNamesById: {
                        ...state.episodeNamesById,
                        [episodeId]: displayName,
                    },
                })),

            removeEpisodeName: (episodeId) =>
                set((state) => {
                    const next = { ...state.episodeNamesById };
                    delete next[episodeId];
                    return { episodeNamesById: next };
                }),

            setEpisodeFolderId: (episodeId, folderId) =>
                set((state) => ({
                    episodeFolderById: {
                        ...state.episodeFolderById,
                        [episodeId]: folderId,
                    },
                })),

            removeEpisodeFolderId: (episodeId) =>
                set((state) => {
                    const next = { ...state.episodeFolderById };
                    delete next[episodeId];
                    return { episodeFolderById: next };
                }),

            removeEpisodeMetadata: (episodeId) =>
                set((state) => {
                    const nextNames = { ...state.episodeNamesById };
                    const nextFolders = { ...state.episodeFolderById };

                    delete nextNames[episodeId];
                    delete nextFolders[episodeId];

                    return {
                        episodeNamesById: nextNames,
                        episodeFolderById: nextFolders,
                    };
                }),

            setLastOpenedEpisodeId: (episodeId) => set({ lastOpenedEpisodeId: episodeId }),

            resetEpisodePanelMetadata: () =>
                set({ ...DEFAULT_EPISODE_PANEL_METADATA_STATE }),
        }),
        {
            name: "amverge_episode_panel_metadata_v1",
        }
    )
);

export function clearEpisodePanelStores() {
    localStorage.removeItem("amverge_episode_panel_v1");
    localStorage.removeItem("amverge_episode_panel_metadata_v1");
    localStorage.removeItem("amverge_episode_panel_migrated_v1");
    localStorage.removeItem("amverge_episode_panel_migrated_v2");

    useEpisodePanelRuntimeStore.getState().resetEpisodePanelRuntime();
    useEpisodePanelMetadataStore.getState().resetEpisodePanelMetadata();
}