import { useState } from "react";
type ImportButtonsProps = {
  cols: number;
  gridSize: number;
  onBigger: () => void;
  onSmaller: () => void;
  setGridPreview: (checked: boolean) => void;
  gridPreview: boolean;
  selectedClips: Set<string>;
  setSelectedClips: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
};
export default function ImportButtons(props: ImportButtonsProps) {
    const hasSelection = props.selectedClips.size > 0;
    
    return (
        <main className="clips-import">
          <div className="import-buttons-container">
            <button>Import</button>
          </div>
          <div className="grid-checkboxes">
            <div className="checkbox-row">
              <label className="custom-checkbox">
                <input 
                  type="checkbox" 
                  className="checkbox"
                  checked={props.gridPreview}
                  onChange={(e) => props.setGridPreview(e.target.checked)}
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
                  onChange={(e) => {
                    if (!e.target.checked) {
                      props.setSelectedClips(new Set())
                    }
                  }}
                />
                <span className="checkmark"></span>
              </label>
              <span>{props.selectedClips.size} selected</span>    
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