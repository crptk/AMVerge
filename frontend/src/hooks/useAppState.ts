import React, { useReducer } from "react";
import { ClipItem, EpisodeEntry, EpisodeFolder } from "../types/domain";

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

export type AppAction =
  | { type: "setFocusedClip"; value: string | null }
  | { type: "setSelectedClips"; value: Set<string> }
  | { type: "setClips"; value: ClipItem[] }
  | { type: "setEpisodes"; value: EpisodeEntry[] }
  | { type: "setSelectedEpisodeId"; value: string | null }
  | { type: "setEpisodeFolders"; value: EpisodeFolder[] }
  | { type: "setOpenedEpisodeId"; value: string | null }
  | { type: "setSelectedFolderId"; value: string | null }
  | { type: "setImportedVideoPath"; value: string | null }
  | { type: "setVideoIsHEVC"; value: boolean | null };

const initialState: AppState = {
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
};

export default function useAppState() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Stable setters that don't change identity
  const setters = React.useMemo(() => {
    const makeSetter = <T>(type: AppAction["type"]) => {
      return (value: React.SetStateAction<T>) => {
        dispatch({ type, value } as any);
      };
    };

    return {
      setFocusedClip: makeSetter<string | null>("setFocusedClip"),
      setSelectedClips: makeSetter<Set<string>>("setSelectedClips"),
      setClips: makeSetter<ClipItem[]>("setClips"),
      setEpisodes: makeSetter<EpisodeEntry[]>("setEpisodes"),
      setSelectedEpisodeId: makeSetter<string | null>("setSelectedEpisodeId"),
      setEpisodeFolders: makeSetter<EpisodeFolder[]>("setEpisodeFolders"),
      setOpenedEpisodeId: makeSetter<string | null>("setOpenedEpisodeId"),
      setSelectedFolderId: makeSetter<string | null>("setSelectedFolderId"),
      setImportedVideoPath: makeSetter<string | null>("setImportedVideoPath"),
      setVideoIsHEVC: makeSetter<boolean | null>("setVideoIsHEVC"),
    };
  }, [dispatch]);

  return {
    state,
    dispatch,
    ...setters,
  };
}

// Update reducer to handle functional updates
function appReducer(state: AppState, action: any): AppState {
  const resolve = (prev: any, value: any) => 
    typeof value === "function" ? value(prev) : value;

  switch (action.type) {
    case "setFocusedClip": return { ...state, focusedClip: resolve(state.focusedClip, action.value) };
    case "setSelectedClips": return { ...state, selectedClips: resolve(state.selectedClips, action.value) };
    case "setClips": return { ...state, clips: resolve(state.clips, action.value) };
    case "setEpisodes": return { ...state, episodes: resolve(state.episodes, action.value) };
    case "setSelectedEpisodeId": return { ...state, selectedEpisodeId: resolve(state.selectedEpisodeId, action.value) };
    case "setEpisodeFolders": return { ...state, episodeFolders: resolve(state.episodeFolders, action.value) };
    case "setOpenedEpisodeId": return { ...state, openedEpisodeId: resolve(state.openedEpisodeId, action.value) };
    case "setSelectedFolderId": return { ...state, selectedFolderId: resolve(state.selectedFolderId, action.value) };
    case "setImportedVideoPath": return { ...state, importedVideoPath: resolve(state.importedVideoPath, action.value) };
    case "setVideoIsHEVC": return { ...state, videoIsHEVC: resolve(state.videoIsHEVC, action.value) };
    default: return state;
  }
}