// Episode Panel toolbar. Renders Sort, New Folder, and Clear Cache actions.
type EpisodePanelHeaderProps = {
  nextSortDirection: "asc" | "desc";
  setNextSortDirection: React.Dispatch<
    React.SetStateAction<"asc" | "desc">
  >;

  onSortEpisodePanel: (direction: "asc" | "desc") => void;
  openNewFolderModal: (parentFolderId: string | null) => void;
  openClearConfirmModal: () => void;
};

export default function EpisodePanelHeader({
  nextSortDirection,
  setNextSortDirection,
  onSortEpisodePanel,
  openNewFolderModal,
  openClearConfirmModal,
}: EpisodePanelHeaderProps) {
  return (
    <div className="episode-panel-header">
      <div className="episode-panel-title">Episode Panel</div>

      <div className="episode-panel-actions">
        <button
          type="button"
          className="episode-panel-action"
          onClick={() => {
            onSortEpisodePanel(nextSortDirection);

            setNextSortDirection((prev) =>
              prev === "asc" ? "desc" : "asc"
            );
          }}
          title={nextSortDirection === "asc" ? "Sort A–Z" : "Sort Z–A"}
        >
          Sort A–Z {nextSortDirection === "asc" ? "↑" : "↓"}
        </button>

        <button
          type="button"
          className="episode-panel-action"
          onClick={() => openNewFolderModal(null)}
          title="New folder"
        >
          New Folder
        </button>

        <button
          type="button"
          className="episode-panel-action"
          onClick={openClearConfirmModal}
          title="Clear episode panel cache"
        >
          Clear
        </button>
      </div>
    </div>
  );
}