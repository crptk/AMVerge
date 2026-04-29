import { useEffect } from "react";
import { EpisodeEntry, EpisodeFolder } from "../types/domain";
import { useAppStateStore } from "../store/appStore";

type UsePersistenceProps = {
  episodePanelStorageKey: string;
  sidebarWidthStorageKey: string;
  exportDirStorageKey: string;

  handleSelectEpisodeFromStorage: (
    episodeId: string | null,
    episodesList?: EpisodeEntry[]
  ) => void;

  sidebarWidthPx: number;
  exportDir: string | null;
};

export default function usePersistence(props: UsePersistenceProps) {
  const episodes = useAppStateStore((s) => s.episodes);
  const setEpisodes = useAppStateStore((s) => s.setEpisodes);

  const selectedEpisodeId = useAppStateStore((s) => s.selectedEpisodeId);

  const episodeFolders = useAppStateStore((s) => s.episodeFolders);
  const setEpisodeFolders = useAppStateStore((s) => s.setEpisodeFolders);

  const selectedFolderId = useAppStateStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useAppStateStore((s) => s.setSelectedFolderId);
  
  // This runs once on startup to load everything
  useEffect(() => {
    try {
      const raw = localStorage.getItem(props.episodePanelStorageKey);
      if (!raw) return;


      const parsed = JSON.parse(raw) as {
        episodeFolders?: EpisodeFolder[];
        episodes?: EpisodeEntry[];
        selectedFolderId?: string | null;
        selectedEpisodeId?: string | null;
      };

      if (Array.isArray(parsed.episodeFolders)) {
        setEpisodeFolders(
          parsed.episodeFolders
            .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
            .map((f) => ({
              id: f.id,
              name: f.name,
              isExpanded: Boolean((f as any).isExpanded),
              parentId: typeof (f as any).parentId === "string" ? (f as any).parentId : null,
            }))
        );
      }

      if (Array.isArray(parsed.episodes)) setEpisodes(parsed.episodes);

      if (typeof parsed.selectedFolderId === "string" || parsed.selectedFolderId === null) {
        setSelectedFolderId(parsed.selectedFolderId ?? null);
      }

      if (typeof parsed.selectedEpisodeId === "string" || parsed.selectedEpisodeId === null) {
        props.handleSelectEpisodeFromStorage(parsed.selectedEpisodeId, parsed.episodes);
      }
    } catch {}
  }, []);

  // Automatically saves episodePanel data whenever episodes states are modified
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(
          props.episodePanelStorageKey,
          JSON.stringify({
            episodeFolders: episodeFolders,
            episodes: episodes,
            selectedFolderId: selectedFolderId,
            selectedEpisodeId: selectedEpisodeId,
          })
        );
      } catch {
        // ignore
      }
    }, 150);

    return () => window.clearTimeout(handle);
  }, [
    episodeFolders,
    episodes,
    selectedFolderId,
    selectedEpisodeId,
  ]);

  // Automatically updates the width of the sidebar whenever its state is modified 
  useEffect(() => {
    try {
      localStorage.setItem(props.sidebarWidthStorageKey, String(props.sidebarWidthPx));
    } catch {}
  }, [props.sidebarWidthPx]);

  // Automatically updates the export Directory whenever its state is modified
  useEffect(() => {
    try {
      if (props.exportDir) {
        localStorage.setItem(props.exportDirStorageKey, props.exportDir);
      } else {
        localStorage.removeItem(props.exportDirStorageKey);
      }
    } catch {}
  }, [props.exportDir]);
}
