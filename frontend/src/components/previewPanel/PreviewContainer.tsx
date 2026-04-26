import VideoPlayer from "./VideoPlayer.tsx"
import InfoBox from "./InfoBox.tsx"
import React from "react";
import { FaFolderOpen } from "react-icons/fa";
type PreviewContainerProps = {
  focusedClip: string | null;
  focusedClipThumbnail: string | null;
  selectedClips: Set<string>;
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  importToken: string;
  handleExport: (
    selectedClips: Set<string>,
    enableMerged: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  exportDir: string | null;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
};

export default function PreviewContainer (props: PreviewContainerProps) {
  const [mergeEnabled, setMergeEnabled] = React.useState(true);
  const [showMergeNameModal, setShowMergeNameModal] = React.useState(false);
  const mergeNameInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (showMergeNameModal) {
      requestAnimationFrame(() => {
        mergeNameInputRef.current?.focus();
        mergeNameInputRef.current?.select();
      });
    }
  }, [showMergeNameModal]);

  const onExportClick = () => {
    if (mergeEnabled) {
      setShowMergeNameModal(true);
    } else {
      props.handleExport(props.selectedClips, false);
    }
  };

  const confirmMergeExport = () => {
    const value = (mergeNameInputRef.current?.value ?? "").trim();
    if (!value) return;
    setShowMergeNameModal(false);
    props.handleExport(props.selectedClips, true, value);
  };
  return (
    <main  className="preview-container" >
      <div className="preview-window">
        {props.focusedClip ? (
          <VideoPlayer 
           selectedClip={props.focusedClip}
           videoIsHEVC={props.videoIsHEVC}
           userHasHEVC={props.userHasHEVC}
           posterPath={props.focusedClipThumbnail}
           importToken={props.importToken}
          />
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
        <div className="export-dir-row">
          <input
            type="text"
            className="export-dir-input"
            placeholder="Output directory..."
            value={props.exportDir || ""}
            onChange={(e) => props.onExportDirChange(e.target.value)}
          />
          <button
            className="buttons export-dir-browse"
            onClick={props.onPickExportDir}
            title="Browse for output folder"
          >
            <FaFolderOpen />
          </button>
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

      {showMergeNameModal && (
        <div
          className="episode-modal-overlay"
          onMouseDown={() => setShowMergeNameModal(false)}
        >
          <div
            className="episode-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="episode-modal-title">Merged file name</div>
            <input
              ref={mergeNameInputRef}
              className="episode-modal-input"
              placeholder="Enter file name..."
              defaultValue={props.defaultMergedName}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowMergeNameModal(false);
                if (e.key === "Enter") confirmMergeExport();
              }}
            />
            <div className="episode-modal-actions">
              <button
                type="button"
                className="episode-modal-btn"
                onClick={() => setShowMergeNameModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="episode-modal-btn primary"
                onClick={confirmMergeExport}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}