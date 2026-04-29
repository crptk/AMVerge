import { useAppStateStore } from "../store/appStore"
import { useUIStateStore } from "../store/UIStore";

type ImportButtonsProps = {
  gridSize: number;
  onBigger: () => void;
  onSmaller: () => void;
  onImport: () => void;
};

export default function ImportButtons(props: ImportButtonsProps) {
  const gridPreview = useUIStateStore(s => s.gridPreview);
  const setGridPreview = useUIStateStore(s => s.setGridPreview);
  const selectedClips = useAppStateStore(s => s.selectedClips);
  const setSelectedClips = useAppStateStore(s => s.setSelectedClips);
  const loading = useAppStateStore(s => s.loading);
  const hasSelection = selectedClips.size > 0;
  
  return (
      <main className="clips-import">
        <div className="import-buttons-container">
          <button onClick={() => { props.onImport();}}      
                  disabled={loading}
                  id="file-button"
          >
            {loading ? "Processing...": "Import Episode"}
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
                      setSelectedClips(new Set())
                    }
                  }}
                />
                <span className="checkmark"></span>
              </label>
              <span>{selectedClips.size} selected</span>    
            </div>
          </div>
          <div className="zoomWrapper">
            <span>Size: {props.gridSize}px</span>
            <form>
              <button type="button" onClick={props.onSmaller}>-</button>
              <button type="button" onClick={props.onBigger}>+</button>  
            </form>
          </div>
        </div>
      </main>
  )
}