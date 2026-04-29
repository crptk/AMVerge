// Derived structure hook for the Episode Panel. Builds lookup maps and ordered episode lists from folders and episodes.
import { useMemo } from "react";
import type { EpisodeEntry, EpisodeFolder } from "../../../types/domain";
import { useEpisodePanelMetadataStore, useEpisodePanelRuntimeStore } from "../../../store/episodeStore";

export default function useEpisodePanelStructure() {
  const episodes = useEpisodePanelRuntimeStore((s) => s.episodes);
  const episodeFolders = useEpisodePanelMetadataStore((s) => s.episodeFolders);

  const safeFolders = Array.isArray(episodeFolders) ? episodeFolders : [];
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];

  const folderById = useMemo(() => {
    const map = new Map<string, EpisodeFolder>();

    for (const folder of safeFolders) {
      map.set(folder.id, folder);
    }

    return map;
  }, [safeFolders]);

  const foldersByParentId = useMemo(() => {
    const map = new Map<string | null, EpisodeFolder[]>();

    for (const folder of safeFolders) {
      const key = folder.parentId ?? null;
      const list = map.get(key) ?? [];

      list.push(folder);
      map.set(key, list);
    }

    return map;
  }, [safeFolders]);

  const rootEpisodes = useMemo(() => {
    return safeEpisodes.filter((episode) => episode.folderId === null);
  }, [safeEpisodes]);

  const episodesByFolderId = useMemo(() => {
    const map = new Map<string, EpisodeEntry[]>();

    for (const episode of safeEpisodes) {
      if (!episode.folderId) continue;

      const list = map.get(episode.folderId) ?? [];
      list.push(episode);
      map.set(episode.folderId, list);
    }

    return map;
  }, [safeEpisodes]);

  const flatEpisodeOrder = useMemo(() => {
    const order: string[] = [];

    const visitFolder = (parentId: string | null) => {
      const childFolders = foldersByParentId.get(parentId) ?? [];

      for (const folder of childFolders) {
        if (folder.isExpanded) {
          visitFolder(folder.id);

          const eps = episodesByFolderId.get(folder.id) ?? [];
          for (const ep of eps) {
            order.push(ep.id);
          }
        }
      }
    };

    visitFolder(null);

    for (const ep of rootEpisodes) {
      order.push(ep.id);
    }

    return order;
  }, [foldersByParentId, episodesByFolderId, rootEpisodes]);

  return {
    folderById,
    foldersByParentId,
    rootEpisodes,
    episodesByFolderId,
    flatEpisodeOrder,
  };
}