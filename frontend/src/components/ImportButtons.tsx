import { useAppStateStore } from "../stores/appStore";
import { useUIStateStore } from "../stores/UIStore";
import useImportExport from "../hooks/useImportExport";

export default function ImportButtons() {
  const selectedClips = useAppStateStore((s: any) => s.selectedClips);
  const setSelectedClips = useAppStateStore((s: any) => s.setSelectedClips);
  const setTimelineClipIds = useAppStateStore((s: any) => s.setTimelineClipIds);
  const loading = useAppStateStore((s: any) => s.loading);
  const bgProgress = useAppStateStore((s: any) => s.bgProgress);
  const gridPreview = useUIStateStore((s: any) => s.gridPreview);
  const setGridPreview = useUIStateStore((s: any) => s.setGridPreview);
  const cols = useUIStateStore((s: any) => s.cols);
  const setCols = useUIStateStore((s: any) => s.setCols);
  const { onImportClick } = useImportExport();

  const hasSelection = selectedClips.size > 0;

  const handleBigger = () => setCols(Math.max(1, cols - 1));
  const handleSmaller = () => setCols(Math.min(12, cols + 1));
    
  return (
      <main className="clips-import">
        <div className="import-buttons-container">
          <button onClick={onImportClick}
                  disabled={loading || bgProgress !== null}
                  id="file-button"
          >
            {loading ? "Processing..." : "Import Episode"}
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
              <span>Grid preview</span>    
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
                      setSelectedClips(new Set());
                      setTimelineClipIds(new Set());
                    }
                  }}
                />
                <span className="checkmark"></span>
              </label>
              <span>{selectedClips.size} selected</span>    
            </div>
          </div>
          <div className="zoomWrapper">
            <span>Grid: {cols} columns</span>
            <form>
              <button type="button" onClick={handleSmaller}>-</button>
              <button type="button" onClick={handleBigger}>+</button>  
            </form>
          </div>
        </div>
      </main>
  )
}