import { invoke } from "@tauri-apps/api/core";
import type { EpisodeEntry, EpisodeFolder } from "../types/domain";

import {
  useEpisodePanelMetadataStore,
  useEpisodePanelRuntimeStore,
} from "../store/episodeStore"

export function migrateOldEpisodePanelStorage() {
  const OLD_KEY = "amverge_episode_panel_v1";
  const MIGRATION_FLAG = "amverge_episode_panel_migrated_v2";

  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return;

    const parsedRaw = JSON.parse(raw);
    const parsed = parsedRaw.state ?? parsedRaw;

    const metadata = useEpisodePanelMetadataStore.getState();

    if (Array.isArray(parsed.episodeFolders)) {
      metadata.setEpisodeFolders((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));

        return [
          ...prev,
          ...parsed.episodeFolders.filter(
            (f: EpisodeFolder) => f?.id && !existingIds.has(f.id)
          ),
        ];
      });
    }

    for (const ep of parsed.episodes ?? []) {
      if (!ep?.id) continue;

      const name =
        ep.displayName ??
        ep.name ??
        ep.originalName ??
        ep.fileName ??
        ep.title ??
        ep.clips?.[0]?.originalName ??
        null;

      const current = metadata.episodeNamesById[ep.id];

      if (!current && typeof name === "string" && name.trim()) {
        metadata.setEpisodeName(ep.id, name.trim());
      }

      if (
        metadata.episodeFolderById[ep.id] === undefined &&
        "folderId" in ep
      ) {
        metadata.setEpisodeFolderId(ep.id, ep.folderId ?? null);
      }
    }

    localStorage.setItem(MIGRATION_FLAG, "true");
  } catch (err) {
    console.error("Migration failed", err);
  }
}

export async function hydrateEpisodesFromDisk(customPath: string | null) {
  const runtime = useEpisodePanelRuntimeStore.getState();

  runtime.setIsHydratingEpisodes(true);

  try {
    const scannedEpisodes = await invoke<EpisodeEntry[]>(
      "scan_episode_panel_cache",
      { customPath }
    );

    const metadata = useEpisodePanelMetadataStore.getState();


    function getFallbackEpisodeName(episode: EpisodeEntry) {
      return (
        episode.displayName ||
        episode.clips?.[0]?.originalName ||
        episode.id
      );
    }
    const mergedEpisodes = scannedEpisodes.map((episode) => ({
      ...episode,
      displayName:
        metadata.episodeNamesById[episode.id] ?? getFallbackEpisodeName(episode),
      folderId:
        metadata.episodeFolderById[episode.id] ?? null,
    }));

    useEpisodePanelRuntimeStore.getState().setEpisodes(mergedEpisodes);
  } finally {
    useEpisodePanelRuntimeStore.getState().setIsHydratingEpisodes(false);
  }
}