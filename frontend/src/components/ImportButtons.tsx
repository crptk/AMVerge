import { useAppStateStore } from "../stores/appStore";
import { useUIStateStore } from "../stores/UIStore";
import { useGeneralSettingsStore } from "../stores/settingsStore";
import useImportExport from "../hooks/useImportExport";

export default function ImportButtons() {
  const selectedClips = useAppStateStore((s: any) => s.selectedClips);
  const setSelectedClips = useAppStateStore((s: any) => s.setSelectedClips);
  const loading = useAppStateStore((s: any) => s.loading);
  const bgProgress = useAppStateStore((s: any) => s.bgProgress);
  const bgImportProgress = useAppStateStore((s: any) => s.bgImportProgress);
  const gridPreview = useUIStateStore((s: any) => s.gridPreview);
  const setGridPreview = useUIStateStore((s: any) => s.setGridPreview);
  const importMethod = useGeneralSettingsStore((s) => s.importMethod);
  const { onImportClick } = useImportExport();

  const hasSelection = selectedClips.size > 0;
  const importBusy = loading || Boolean(bgProgress) || Boolean(bgImportProgress);
  const previewAllLocked = importMethod === "webp_files";
  const previewAllChecked = previewAllLocked ? true : gridPreview;
    
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
        </div>
        <div className="grid-checkboxes">
          <div className="selectable-checkboxes">
            <div className="checkbox-row">
              <label className="custom-checkbox">
                <input 
                  type="checkbox" 
                  className="checkbox"
                  checked={previewAllChecked}
                  disabled={previewAllLocked}
                  onChange={(e) => {
                    if (!previewAllLocked) {
                      setGridPreview(e.target.checked);
                    }
                  }}
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