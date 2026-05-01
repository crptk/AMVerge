import VideoPlayer from "./videoPlayer/VideoPlayer.tsx"
import HowToUse from "./HowToUse.tsx"
import React from "react";
import { FaFolderOpen, FaFileExport, FaVideo, FaLayerGroup, FaFolder, FaRocket, FaCodeBranch } from "react-icons/fa";
import { GeneralSettings } from "../../settings/generalSettings";
import { type EditorTarget } from "../../hooks/useImportExport";
import { EDITOR_TARGETS, supportsOriginalCut } from "../../features/export/targets";
import Dropdown from "../common/Dropdown";

const EXPORT_OPTIONS = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "mov", label: "MOV" },
  { value: "avi", label: "AVI" },
  { value: "xml", label: "XML" },
];

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
    mergeFileName?: string,
    editorTarget?: EditorTarget
  ) => Promise<void>;
  handleExportOriginal: (
    selectedClips: Set<string>,
    editorTarget?: EditorTarget
  ) => Promise<void>;
  exportDir: string | null;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
  generalSettings: GeneralSettings;
  setGeneralSettings: React.Dispatch<React.SetStateAction<GeneralSettings>>;
};

export default function PreviewContainer (props: PreviewContainerProps) {
  const [mergeEnabled, setMergeEnabled] = React.useState(true);
  const [editorTarget] = React.useState<EditorTarget>("premier_pro");
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
      props.handleExport(props.selectedClips, false, undefined, editorTarget);
    }
  };
  const isOriginalCutSupported = supportsOriginalCut(editorTarget);

  const confirmMergeExport = () => {
    const value = (mergeNameInputRef.current?.value ?? "").trim();
    if (!value) return;
    setShowMergeNameModal(false);
    props.handleExport(props.selectedClips, true, value, editorTarget);
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
      <div className="export-panel">
        <div className="export-header">
          <FaFileExport className="header-icon" />
          <span className="export-title">EXPORT TO EDITING SOFTWARE</span>
        </div>

        <div className="export-settings-row">
          <div className="export-setting-group">
            <label className="export-label">
              <FaVideo className="label-icon" /> Format
            </label>
            <Dropdown
              className="export-format-select"
              options={EXPORT_OPTIONS}
              value={props.generalSettings.exportFormat}
              onChange={(val) =>
                props.setGeneralSettings((prev) => ({
                  ...prev,
                  exportFormat: val as any,
                }))
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
        </div>

        <button 
          className="buttons export-main-button" 
          id="file-button"
          onClick={onExportClick}
        >
          <FaRocket className="btn-icon" /> Export Now
        </button>
        <button
          className="buttons export-original-button"
          disabled={!isOriginalCutSupported}
          onClick={() => props.handleExportOriginal(props.selectedClips, editorTarget)}
          title={
            isOriginalCutSupported
              ? `Send original timeline cut to ${EDITOR_TARGETS.find((t) => t.value === editorTarget)?.label ?? "editor"}`
              : "Original Cut is not available for CapCut"
          }
        >
          <FaCodeBranch className="btn-icon" /> Export Original Cut
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
