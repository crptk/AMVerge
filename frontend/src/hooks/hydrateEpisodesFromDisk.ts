import { invoke } from "@tauri-apps/api/core";
import type { EpisodeEntry } from "../types/domain";
import {
  useEpisodePanelMetadataStore,
  useEpisodePanelRuntimeStore,
} from "../store/episodeStore"

export function migrateOldEpisodePanelStorage() {
  const OLD_KEY = "amverge_episode_panel_v1";
  const MIGRATION_FLAG = "amverge_episode_panel_migrated_v1";

  if (localStorage.getItem(MIGRATION_FLAG)) return;

  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);

    const metadataStore = useEpisodePanelMetadataStore.getState();

    // migrate episode names
    for (const ep of parsed.episodes ?? []) {
      if (ep?.id && (ep.displayName || ep.name)) {
        metadataStore.setEpisodeName(
          ep.id,
          ep.displayName ?? ep.name
        );
      }
    }

    // migrate folders
    if (Array.isArray(parsed.episodeFolders)) {
      metadataStore.setEpisodeFolders(parsed.episodeFolders);
    }

    // migrate folder assignments
    for (const ep of parsed.episodes ?? []) {
      if (ep?.id && "folderId" in ep) {
        metadataStore.setEpisodeFolderId(ep.id, ep.folderId ?? null);
      }
    }

    localStorage.setItem(MIGRATION_FLAG, "true");
  } catch (e) {
    console.error("Migration failed", e);
  }
}

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