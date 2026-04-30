import { useState, useEffect } from "react";
import { useAppStateStore } from "../store/appStore"
import { useUIStateStore } from "../store/UIStore";

type ImportButtonsProps = {
  gridRef: React.RefObject<HTMLDivElement | null>;
  onImport: () => void;
};

export default function ImportButtons(props: ImportButtonsProps) {
  const gridPreview = useUIStateStore(s => s.gridPreview);
  const setGridPreview = useUIStateStore(s => s.setGridPreview);
  const cols = useUIStateStore(s => s.cols);
  const incrementCols = useUIStateStore(s => s.incrementCols);
  const decrementCols = useUIStateStore(s => s.decrementCols);

  const selectedClips = useAppStateStore(s => s.selectedClips);
  const setSelectedClips = useAppStateStore(s => s.setSelectedClips);
  const loading = useAppStateStore(s => s.loading);
  const hasSelection = selectedClips.size > 0;

  const [gridSize, setGridSize] = useState(0);

  useEffect(() => {
    const updateSize = () => {
      if (props.gridRef.current) {
        setGridSize(Math.floor(props.gridRef.current.offsetWidth / cols));
      }
    };

    updateSize();

    const ro = new ResizeObserver(updateSize);
    if (props.gridRef.current) {
      ro.observe(props.gridRef.current);
    }
    window.addEventListener("resize", updateSize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [cols, props.gridRef]);

  return (
    <main className="clips-import">
      <div className="import-buttons-container">
        <button onClick={() => { props.onImport(); }}
          disabled={loading}
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
          <span>Size: {gridSize}px</span>
          <form>
            <button type="button" onClick={incrementCols}>-</button>
            <button type="button" onClick={decrementCols}>+</button>
          </form>
        </div>
      </div>
    </main>
  )
}