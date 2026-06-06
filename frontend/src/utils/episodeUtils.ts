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

export const detectScenes = async (
  videoPath: string,
  episodeCacheId: string,
  customPath: string | null = null
) => {
    // calls backend passing in video file and threshold
    const result = await invoke<string>("detect_scenes", {
      videoPath: videoPath,
      episodeCacheId: episodeCacheId,
      customPath: customPath,
    });

    // contains path to all clips along w other metadata
    const scenes = JSON.parse(result);

    // turns to an array of objects
    return scenes.map((s: any) => ({
      id: crypto.randomUUID(),
      src: s.path,
      thumbnail: s.thumbnail,
      originalName: s.original_file,
      originalPath: s.original_path ?? videoPath,
      sceneIndex: typeof s.scene_index === "number" ? s.scene_index : undefined,
      startSec: typeof s.start === "number" ? s.start : undefined,
      endSec: typeof s.end === "number" ? s.end : null,
      start: s.start,
      end: s.end
    }));
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

export function remapEpisodeCachePath(path: string, oldRoot: string, newRoot: string): string {
  const remapped = remapPathRoot(path, oldRoot, newRoot);

  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/");
  const normalizedOldRoot = normalize(oldRoot).replace(/\/+$/, "").toLowerCase();
  const normalizedPath = normalize(path).toLowerCase();

  if (
    normalizedPath !== normalizedOldRoot &&
    !normalizedPath.startsWith(normalizedOldRoot + "/")
  ) {
    return path;
  }

  const normalizedRemapped = normalize(remapped);
  const relative = normalizedRemapped
    .slice(normalize(newRoot).replace(/\/+$/, "").length)
    .replace(/^\/+/, "");

  // Supported cache layouts:
  // - <root>/<uuid>/...
  // - <root>/episodes/<uuid>/...
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i;
  const matchesRootUuid = isUuid.test(relative);
  const matchesEpisodesUuid = /^episodes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i.test(relative);

  if (!matchesRootUuid && !matchesEpisodesUuid) {
    return path;
  }

  return remapped;
}
