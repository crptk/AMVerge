import VideoPlayer from "../components/VideoPlayer.tsx"
import InfoBox from "../components/InfoBox.tsx"
import useState from "react";
type PreviewContainerProps = {
  selectedClip: string | null;
};

export default function PreviewContainer ({ selectedClip }: PreviewContainerProps) {
  return (
    <main  className="preview-container" >
      <div className="preview-window">
        {selectedClip ? (
          <VideoPlayer 
           selectedClip={ selectedClip }/>
          ) : (
            <p>No clip selected</p>
        )}
      </div>
      <div className="preview-export">
        <div className="checkbox-row">
            <label className="custom-checkbox">
              <input type="checkbox" className="checkbox"></input>
              <span className="checkmark"></span>
            </label>
          <p>Merge clips</p>
        </div>
        <button className="buttons">Export</button>
      </div>
      <InfoBox/>
    </main>
  )
}