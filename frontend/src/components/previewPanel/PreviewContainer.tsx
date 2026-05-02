import VideoPlayer from "./videoPlayer/VideoPlayer.tsx"
import HowToUse from "./HowToUse.tsx"
import React from "react";
import { FaFolderOpen, FaFileExport, FaVideo, FaLayerGroup, FaFolder, FaRocket } from "react-icons/fa";
import Dropdown from "../common/Dropdown";
import { useGeneralSettingsStore } from "../../store/settingsStore.ts";
import { useAppStateStore } from "../../store/appStore.ts";

const EXPORT_OPTIONS = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "mov", label: "MOV" },
  { value: "avi", label: "AVI" },
  { value: "xml", label: "XML" },
];
type PreviewContainerProps = {
  programClip: string | null;
  programClipThumbnail: string | null;
  programTime?: number;

  // Source (Grid)
  sourceClip: string | null;
  sourceClipThumbnail: string | null;
  selectedClips: Set<string>;
  timelineClipIds: Set<string>;
  userHasHEVC: React.RefObject<boolean>;
  handleExport: (
    selectedClips: Set<string>,
    enableMerged: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
  onTimeUpdate?: (time: number) => void;
  activeMode?: "selector" | "editor";
};

export default function PreviewContainer (props: PreviewContainerProps) {
  const [mergeEnabled, setMergeEnabled] = React.useState(true);
  const [showMergeNameModal, setShowMergeNameModal] = React.useState(false);
  const mergeNameInputRef = React.useRef<HTMLInputElement | null>(null);
  const [activeView, setActiveView] = React.useState<"source" | "program">("source");
  const exportFormat = useGeneralSettingsStore(s => s.exportFormat);

  const selectedClips = useAppStateStore(s => s.selectedClips);
  const focusedClip = useAppStateStore(s => s.focusedClip);
  const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
  const setExportFormat = useGeneralSettingsStore(s => s.setExportFormat);
  const exportPath = useGeneralSettingsStore(s => s.exportPath);

  const hasProgram = !!props.programClip;
  const hasSource = !!props.sourceClip;

  // Auto-switch to program when timeline is scrubbed/active (Only on initial load/presence)
  React.useEffect(() => {
    if (props.activeMode === "editor") {
      setActiveView("program");
    } else if (props.activeMode === "selector" && hasSource) {
      setActiveView("source");
    }
  }, [props.activeMode, hasSource, hasProgram]);

  // Auto-switch to SOURCE when a new clip is focused in the grid
  const lastSourceRef = React.useRef(props.sourceClip);
  React.useEffect(() => {
    if (props.sourceClip && props.sourceClip !== lastSourceRef.current) {
      setActiveView("source");
    }
    lastSourceRef.current = props.sourceClip;
  }, [props.sourceClip]);
  
  React.useEffect(() => {
    if (showMergeNameModal) {
      requestAnimationFrame(() => {
        mergeNameInputRef.current?.focus();
        mergeNameInputRef.current?.select();
      });
    }
  }, [showMergeNameModal]);

  const onExportClick = () => {
    const targetClips = activeView === "program" ? props.timelineClipIds : props.selectedClips;
    if (mergeEnabled) {
      setShowMergeNameModal(true);
    } else {
      props.handleExport(targetClips, false);
    }
  };

  const confirmMergeExport = () => {
    const value = (mergeNameInputRef.current?.value ?? "").trim();
    if (!value) return;
    setShowMergeNameModal(false);
    props.handleExport(selectedClips, true, value);
  };
  return (
    <main  className="preview-container" >
      <div className="preview-window">
        {focusedClip ? (
          <VideoPlayer 
           selectedClip={focusedClip}
           videoIsHEVC={videoIsHEVC}
           userHasHEVC={props.userHasHEVC}
           posterPath={props.focusedClipThumbnail}
          />
          ) : (
            <p>No clip selected</p>
        )}
      </div>
      <div className="export-panel">
        <div className="export-header">
          <FaFileExport className="header-icon" />
          <span className="export-title">EXPORT SETTINGS</span>
        </div>

        <div className="export-settings-row">
          <div className="export-setting-group">
            <label className="export-label">
              <FaVideo className="label-icon" /> Format
            </label>
            <Dropdown
              className="export-format-select"
              options={EXPORT_OPTIONS}
              value={exportFormat}
              onChange={() =>
                {
                  setExportFormat(exportFormat); 
                }
              }
            />
          </div>

          <div className="export-setting-group">
            <label className="export-label">
              <FaLayerGroup className="label-icon" /> Options
            </label>
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
          </div>
        </div>

        <div className="export-path-section">
          <label className="export-label">
            <FaFolder className="label-icon" /> Output Directory
          </label>
          <div className="export-dir-row">
            <input
              type="text"
              className="export-dir-input"
              placeholder="Select destination..."
              value={exportPath || ""}
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
        </div>

        <button 
          className="buttons export-main-button" 
          id="file-button"
          onClick={onExportClick}
        >
          <FaRocket className="btn-icon" /> Export Now
        </button>
      </div>
      
      <HowToUse/>

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