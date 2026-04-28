import React, { useCallback, useReducer } from "react";
import { ClipItem, EpisodeEntry, EpisodeFolder } from "../types/domain";

type SetterValue<T> = T | ((prev: T) => T);

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
  | { type: "setFocusedClip"; value: SetterValue<string | null> }
  | { type: "setSelectedClips"; value: SetterValue<Set<string>> }
  | { type: "setClips"; value: SetterValue<ClipItem[]> }
  | { type: "setEpisodes"; value: SetterValue<EpisodeEntry[]> }
  | { type: "setSelectedEpisodeId"; value: SetterValue<string | null> }
  | { type: "setEpisodeFolders"; value: SetterValue<EpisodeFolder[]> }
  | { type: "setOpenedEpisodeId"; value: SetterValue<string | null> }
  | { type: "setSelectedFolderId"; value: SetterValue<string | null> }
  | { type: "setImportedVideoPath"; value: SetterValue<string | null> }
  | { type: "setVideoIsHEVC"; value: SetterValue<boolean | null> };

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

function resolveSetterValue<T>(prev: T, value: SetterValue<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(prev)
    : value;
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setFocusedClip":
      return { ...state, focusedClip: resolveSetterValue(state.focusedClip, action.value) };
    case "setSelectedClips":
      return { ...state, selectedClips: resolveSetterValue(state.selectedClips, action.value) };
    case "setClips":
      return { ...state, clips: resolveSetterValue(state.clips, action.value) };
    case "setEpisodes":
      return { ...state, episodes: resolveSetterValue(state.episodes, action.value) };
    case "setSelectedEpisodeId":
      return { ...state, selectedEpisodeId: resolveSetterValue(state.selectedEpisodeId, action.value) };
    case "setEpisodeFolders":
      return { ...state, episodeFolders: resolveSetterValue(state.episodeFolders, action.value) };
    case "setOpenedEpisodeId":
      return { ...state, openedEpisodeId: resolveSetterValue(state.openedEpisodeId, action.value) };
    case "setSelectedFolderId":
      return { ...state, selectedFolderId: resolveSetterValue(state.selectedFolderId, action.value) };
    case "setImportedVideoPath":
      return { ...state, importedVideoPath: resolveSetterValue(state.importedVideoPath, action.value) };
    case "setVideoIsHEVC":
      return { ...state, videoIsHEVC: resolveSetterValue(state.videoIsHEVC, action.value) };
    default: return state;
  }
}

export default function useAppState() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const setFocusedClip = useCallback((value: React.SetStateAction<string | null>) => {
    dispatch({ type: "setFocusedClip", value });
  }, [dispatch]);
  const setSelectedClips = useCallback((value: React.SetStateAction<Set<string>>) => {
    dispatch({ type: "setSelectedClips", value });
  }, [dispatch]);
  const setClips = useCallback((value: React.SetStateAction<ClipItem[]>) => {
    dispatch({ type: "setClips", value });
  }, [dispatch]);
  const setEpisodes = useCallback((value: React.SetStateAction<EpisodeEntry[]>) => {
    dispatch({ type: "setEpisodes", value });
  }, [dispatch]);
  const setSelectedEpisodeId = useCallback((value: React.SetStateAction<string | null>) => {
    dispatch({ type: "setSelectedEpisodeId", value });
  }, [dispatch]);
  const setEpisodeFolders = useCallback((value: React.SetStateAction<EpisodeFolder[]>) => {
    dispatch({ type: "setEpisodeFolders", value });
  }, [dispatch]);
  const setOpenedEpisodeId = useCallback((value: React.SetStateAction<string | null>) => {
    dispatch({ type: "setOpenedEpisodeId", value });
  }, [dispatch]);
  const setSelectedFolderId = useCallback((value: React.SetStateAction<string | null>) => {
    dispatch({ type: "setSelectedFolderId", value });
  }, [dispatch]);
  const setImportedVideoPath = useCallback((value: React.SetStateAction<string | null>) => {
    dispatch({ type: "setImportedVideoPath", value });
  }, [dispatch]);
  const setVideoIsHEVC = useCallback((value: React.SetStateAction<boolean | null>) => {
    dispatch({ type: "setVideoIsHEVC", value });
  }, [dispatch]);

  return {
    state,
    dispatch,
    setFocusedClip,
    setSelectedClips,
    setClips,
    setEpisodes,
    setSelectedEpisodeId,
    setEpisodeFolders,
    setOpenedEpisodeId,
    setSelectedFolderId,
    setImportedVideoPath,
    setVideoIsHEVC,
  };
}
