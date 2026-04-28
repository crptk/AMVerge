import { useEffect } from "react";
import { EpisodeEntry, EpisodeFolder } from "../types/domain";

type UsePersistenceProps = {
  episodePanelStorageKey: string;
  sidebarWidthStorageKey: string;
  exportDirStorageKey: string;

  episodeFolders: EpisodeFolder[];
  episodes: EpisodeEntry[];
  selectedFolderId: string | null;
  selectedEpisodeId: string | null;

  setEpisodeFolders: React.Dispatch<React.SetStateAction<EpisodeFolder[]>>;
  setEpisodes: React.Dispatch<React.SetStateAction<EpisodeEntry[]>>;
  setSelectedFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  handleSelectEpisodeFromStorage: (
    episodeId: string | null,
    episodesList?: EpisodeEntry[]
  ) => void;

  sidebarWidthPx: number;
  exportDir: string | null;
};

export default function usePersistence(props: UsePersistenceProps) {
  // This runs once on startup to load everything
  useEffect(() => {
    try {
      const raw = localStorage.getItem(props.episodePanelStorageKey);
      if (!raw) return;


      console.log("EPISODE PANEL RAW STORAGE:");
      console.log(raw);
            
      const parsed = JSON.parse(raw) as {
        episodeFolders?: EpisodeFolder[];
        episodes?: EpisodeEntry[];
        selectedFolderId?: string | null;
        selectedEpisodeId?: string | null;
      };

      if (Array.isArray(parsed.episodeFolders)) {
        props.setEpisodeFolders(
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

      if (Array.isArray(parsed.episodes)) props.setEpisodes(parsed.episodes);

      if (typeof parsed.selectedFolderId === "string" || parsed.selectedFolderId === null) {
        props.setSelectedFolderId(parsed.selectedFolderId ?? null);
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
            episodeFolders: props.episodeFolders,
            episodes: props.episodes,
            selectedFolderId: props.selectedFolderId,
            selectedEpisodeId: props.selectedEpisodeId,
          })
        );
      } catch {
        // ignore
      }
    }, 150);

    return () => window.clearTimeout(handle);
  }, [
    props.episodeFolders,
    props.episodes,
    props.selectedFolderId,
    props.selectedEpisodeId,
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