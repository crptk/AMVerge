import type React from "react";
import type { PointerDragSource } from "../types";
import { useEpisodePanelRuntimeStore } from "../../../store/episodeStore";
import type { EpisodeEntry } from "../../../types/domain";

type Episode = EpisodeEntry;
type EpisodeRowProps = {
  episode: Episode;
  folderId: string | null;
  depth?: number;
  multiSelectedIds: Set<string>;
  isDropTarget: boolean;

  beginPointerDrag: (
    source: PointerDragSource
  ) => (e: React.PointerEvent) => void;

  handleEpisodeClick: (episodeId: string) => (e: React.MouseEvent) => void;
  openContextMenu: (episodeId: string, e: React.MouseEvent) => void;
  onOpenEpisode: (episodeId: string) => void;
};

export default function EpisodeRow({
  episode,
  folderId,
  depth = 0,
  multiSelectedIds,
  isDropTarget,
  beginPointerDrag,
  handleEpisodeClick,
  openContextMenu,
  onOpenEpisode,
}: EpisodeRowProps) {
  const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  const selectedEpisodeId = useEpisodePanelRuntimeStore(s => s.selectedEpisodeId);
  const isOpen = openedEpisodeId === episode.id;
  const isSelected = selectedEpisodeId === episode.id;
  const isMultiSelected = multiSelectedIds.has(episode.id); 

  let rowClass = "episode-panel-row episode-row";
  if (isOpen) rowClass += " is-open";
  else if (isSelected) rowClass += " is-focused";
  if (isMultiSelected) rowClass += " is-multi-selected";
  if (isDropTarget) rowClass += " is-drop-target";

  const paddingLeft =
    folderId === null ? undefined : `${8 + depth * 12 + 28}px`;

  return (
    <div
      className={rowClass}
      data-episode-id={episode.id}
      data-episode-folder-id={folderId ?? ""}
      style={paddingLeft ? { paddingLeft } : undefined}
      onPointerDown={beginPointerDrag({ type: "episode", id: episode.id })}
      onClick={handleEpisodeClick(episode.id)}
      onDoubleClick={() => onOpenEpisode(episode.id)}
      onContextMenu={(e) => openContextMenu(episode.id, e)}
      title={episode.videoPath}
    >
      <span className="episode-panel-episode-name">
        {episode.displayName || episode.id}
      </span>
    </div>
  );
}