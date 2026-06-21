import { invoke } from "@tauri-apps/api/core";

import { useAppStateStore } from "../stores/appStore";
import {
  useEpisodePanelMetadataStore,
  useEpisodePanelRuntimeStore,
} from "../stores/episodeStore";
import { useGeneralSettingsStore } from "../stores/settingsStore";

/**
 * Wipes the episode panel UI state and asks the backend to delete all cached
 * episode artifacts on disk. Used by the Episode Panel "clear cache" flow and
 * the General Settings "Clear Episode Panel" button.
 */
export async function clearEpisodePanelCache(): Promise<void> {
  const episodeRuntime = useEpisodePanelRuntimeStore.getState();
  const episodeMetadata = useEpisodePanelMetadataStore.getState();
  const appState = useAppStateStore.getState();

  episodeRuntime.setEpisodes([]);
  episodeMetadata.setEpisodeFolders([]);
  episodeRuntime.setSelectedFolderId(null);
  episodeRuntime.setSelectedEpisodeId(null);
  episodeRuntime.setOpenedEpisodeId(null);
  appState.setSelectedClips(new Set());
  appState.setFocusedClip(null);
  appState.setFocusedClipId(null);
  appState.setClips([]);
  appState.setImportedVideoPath(null);
  appState.setVideoIsHEVC(null);

  try {
    const customPath = useGeneralSettingsStore.getState().episodesPath;
    await invoke("clear_episode_panel_cache", { customPath });
  } catch (err) {
    console.error("clear_episode_panel_cache failed:", err);
    throw err;
  }
}

export const truncateFileName = (name: string): string => {
    if (name.length <= 23) return name;
    return name.slice(0, 10) + "..." + name.slice(-10);
};


export const loadEpisodeManifest = async (
  episodeCacheId: string,
  customPath: string | null = null
) => {
  const raw = await invoke<string>("load_episode_manifest", {
    episodeCacheId,
    customPath,
  });

  return JSON.parse(raw);
};

export function fileNameFromPath(path: string): string {
  const last = path.split(/[/\\]/).pop();
  return last || path;
}

export function remapPathRoot(path: string, oldRoot: string, newRoot: string): string {
  const normalize = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  const displayNormalize = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "");

  const normalizedPath = normalize(path);
  const normalizedOldRoot = normalize(oldRoot);
  const cleanNewRoot = displayNormalize(newRoot);

  if (
    normalizedPath !== normalizedOldRoot &&
    !normalizedPath.startsWith(normalizedOldRoot + "/")
  ) {
    return path;
  }

  const cleanOriginalPath = displayNormalize(path);
  const relativePath = cleanOriginalPath.slice(displayNormalize(oldRoot).length);

  return cleanNewRoot + relativePath;
}
