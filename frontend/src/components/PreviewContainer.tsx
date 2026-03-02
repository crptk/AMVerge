import VideoPlayer from "../components/VideoPlayer.tsx"
import InfoBox from "../components/InfoBox.tsx"
import useState from "react";
import React from "react";
type PreviewContainerProps = {
  selectedClip: string | null;
  selectedClips: Set<string>;
  handleExport: (
    selectedClips: Set<string>,
    enableMerged: boolean
  ) => Promise<void>;
};

export default function PreviewContainer (props: PreviewContainerProps) {
  const [mergeEnabled, setMergeEnabled] = React.useState(true);
  const onExportClick = () => {
    props.handleExport(props.selectedClips, mergeEnabled);
  }
  return (
    <main  className="preview-container" >
      <div className="preview-window">
        {props.selectedClip ? (
          <VideoPlayer 
           selectedClip={ props.selectedClip }/>
          ) : (
            <p>No clip selected</p>
        )}
      </div>
      <div className="preview-export">
        <div className="checkbox-row">
          <label className="custom-checkbox">
            <input 
              type="checkbox"
              className="checkbox"
              checked={mergeEnabled}
              onChange={(e) => setMergeEnabled(e.target.checked)}
            />
            <span className="checkmark"></span>
          </label>
          <p>Merge clips</p>
        </div>
        <button 
          className="buttons" 
          id="file-button"
          onClick={onExportClick}
        >
          Export
        </button>
      </div>
      
      <InfoBox/>
    </main>
  );
}