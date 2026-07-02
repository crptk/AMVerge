import { useState } from "react";
import { FaSyncAlt } from "react-icons/fa";
import { useAppStateStore } from "../stores/appStore";
import { useUIStateStore } from "../stores/UIStore";
import { useEpisodePanelRuntimeStore } from "../stores/episodeStore";
import { openEpisodeById } from "../hooks/useEpisodePanelState";
import useImportExport from "../hooks/useImportExport";

export default function ImportButtons() {
  const selectedClips = useAppStateStore((s: any) => s.selectedClips);
  const setSelectedClips = useAppStateStore((s: any) => s.setSelectedClips);
  const loading = useAppStateStore((s: any) => s.loading);
  const bgProgress = useAppStateStore((s: any) => s.bgProgress);
  const bgImportProgress = useAppStateStore((s: any) => s.bgImportProgress);
  const gridPreview = useUIStateStore((s: any) => s.gridPreview);
  const setGridPreview = useUIStateStore((s: any) => s.setGridPreview);
  const openedEpisodeId = useEpisodePanelRuntimeStore((s) => s.openedEpisodeId);
  const { onImportClick } = useImportExport();

  // Drives the one-shot spin animation on the refresh icon.
  const [refreshSpinning, setRefreshSpinning] = useState(false);

  const hasSelection = selectedClips.size > 0;
  const importBusy = loading || Boolean(bgProgress) || Boolean(bgImportProgress);

  // Re-opens the current episode: fresh import token, cleared selection/focus,
  // remounted tiles — same reset as switching away and back, without leaving.
  const handleRefreshEpisode = () => {
    if (!openedEpisodeId || importBusy) return;
    setRefreshSpinning(true);
    openEpisodeById(openedEpisodeId);
  };

  return (
      <main className="clips-import">
        <div className="import-buttons-container">
          <button onClick={onImportClick}
                  className="import-button"
                  disabled={importBusy}
                  id="file-button"
          >
            {importBusy ? "Processing...": "Import Episode"}
          </button>
          <button
            onClick={handleRefreshEpisode}
            className="import-button refresh-button"
            disabled={importBusy || !openedEpisodeId}
            title="Refresh episode"
            aria-label="Refresh episode"
          >
            <FaSyncAlt
              className={refreshSpinning ? "refresh-icon spinning" : "refresh-icon"}
              onAnimationEnd={() => setRefreshSpinning(false)}
            />
          </button>
        </div>
        <div className="grid-checkboxes">
          <div className="selectable-checkboxes">
            <div className="checkbox-row">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={gridPreview}
                  onChange={(e) => setGridPreview(e.target.checked)}
                />
                <span className="checkmark"></span>
              </label>
              <span>Preview All</span>
            </div>
            <div className="checkbox-row">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={hasSelection}
                  disabled={!hasSelection}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      setSelectedClips(new Set())
                    }
                  }}
                />
                <span className="checkmark"></span>
              </label>
              <span>{selectedClips.size} selected</span>
            </div>
          </div>
        </div>
      </main>
  )
}
