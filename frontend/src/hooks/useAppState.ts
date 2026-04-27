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

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setFocusedClip": return { ...state, focusedClip: action.value };
    case "setSelectedClips": return { ...state, selectedClips: action.value };
    case "setClips": return { ...state, clips: action.value };
    case "setEpisodes": return { ...state, episodes: action.value };
    case "setSelectedEpisodeId": return { ...state, selectedEpisodeId: action.value };
    case "setEpisodeFolders": return { ...state, episodeFolders: action.value };
    case "setOpenedEpisodeId": return { ...state, openedEpisodeId: action.value };
    case "setSelectedFolderId": return { ...state, selectedFolderId: action.value };
    case "setImportedVideoPath": return { ...state, importedVideoPath: action.value };
    case "setVideoIsHEVC": return { ...state, videoIsHEVC: action.value };
    default: return state;
  }
}

export default function useAppState() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  function makeReducerSetter<T>(type: AppAction["type"], current: T) {
    return (value: React.SetStateAction<T>) => {
      const resolved =
        typeof value === "function"
          ? (value as (prev: T) => T)(current)
          : value;

      dispatch({ type, value: resolved } as AppAction);
    };
  }

  return {
    state,
    dispatch,
    setFocusedClip: makeReducerSetter<string | null>("setFocusedClip", state.focusedClip),
    setSelectedClips: makeReducerSetter<Set<string>>("setSelectedClips", state.selectedClips),
    setClips: makeReducerSetter<ClipItem[]>("setClips", state.clips),
    setEpisodes: makeReducerSetter<EpisodeEntry[]>("setEpisodes", state.episodes),
    setSelectedEpisodeId: makeReducerSetter<string | null>("setSelectedEpisodeId", state.selectedEpisodeId),
    setEpisodeFolders: makeReducerSetter<EpisodeFolder[]>("setEpisodeFolders", state.episodeFolders),
    setOpenedEpisodeId: makeReducerSetter<string | null>("setOpenedEpisodeId", state.openedEpisodeId),
    setSelectedFolderId: makeReducerSetter<string | null>("setSelectedFolderId", state.selectedFolderId),
    setImportedVideoPath: makeReducerSetter<string | null>("setImportedVideoPath", state.importedVideoPath),
    setVideoIsHEVC: makeReducerSetter<boolean | null>("setVideoIsHEVC", state.videoIsHEVC),
  };
}