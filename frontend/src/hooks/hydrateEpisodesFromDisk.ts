import { invoke } from "@tauri-apps/api/core";
import type { EpisodeEntry } from "../types/domain";
import {
  useEpisodePanelMetadataStore,
  useEpisodePanelRuntimeStore,
} from "../store/episodeStore"

export async function hydrateEpisodesFromDisk(customPath: string | null) {
  const runtime = useEpisodePanelRuntimeStore.getState();
  const metadata = useEpisodePanelMetadataStore.getState();

  runtime.setIsHydratingEpisodes(true);

  try {
    const scannedEpisodes = await invoke<EpisodeEntry[]>(
      "scan_episode_panel_cache",
      {
        customPath,
      }
    );

    const mergedEpisodes = scannedEpisodes.map((episode) => ({
      ...episode,
      displayName:
        metadata.episodeNamesById[episode.id] ?? episode.displayName,
      folderId:
        metadata.episodeFolderById[episode.id] ?? null,
    }));

    useEpisodePanelRuntimeStore.getState().setEpisodes(mergedEpisodes);
  } finally {
    useEpisodePanelRuntimeStore
      .getState()
      .setIsHydratingEpisodes(false);
  }
}