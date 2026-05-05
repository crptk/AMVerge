import VideoPlayer from "./videoPlayer/VideoPlayer.tsx"
import HowToUse from "./HowToUse.tsx"
import React from "react";
import {
  FaFolderOpen,
  FaFileExport,
  FaFolder,
  FaRocket,
  FaTags,
} from "react-icons/fa";
import Dropdown from "../common/Dropdown";
import { useAppStateStore } from "../../stores/appStore.ts";
import { useAppPersistedStore } from "../../stores/appStore.ts";
import { useUIStateStore } from "../../stores/UIStore.ts";
import { useGeneralSettingsStore } from "../../stores/settingsStore.ts";
import useImportExport from "../../hooks/useImportExport";
import { renderProfileIcon } from "../../features/export/profileIconUtils.tsx";
import {
  getActiveExportProfile,
  getExportProfileSummary,
  supportsClipMerge,
} from "../../features/export/profiles.ts";
type PreviewContainerProps = {
  // Program (Timeline)
  programClip: string | null;
  programClipThumbnail: string | null;
  programTime?: number;

  // Source (Grid)
  sourceClip: string | null;
  sourceClipThumbnail: string | null;
  onTimeUpdate?: (time: number) => void;
};

export default function PreviewContainer (props: PreviewContainerProps) {
  const [showMergeNameModal, setShowMergeNameModal] = React.useState(false);
  const mergeNameInputRef = React.useRef<HTMLInputElement | null>(null);

  const [activeView, setActiveView] = React.useState<"source" | "program">("source");

  const clips = useAppStateStore(s => s.clips);
  const selectedClips = useAppStateStore(s => s.selectedClips);
  const timelineClipIds = useAppStateStore(s => s.timelineClipIds);
  const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
  const userHasHEVC = useAppStateStore(s => s.userHasHEVC);
  const importToken = useAppStateStore(s => s.importToken);
  const exportDir = useAppPersistedStore(s => s.exportDir);
  const setExportDir = useAppPersistedStore(s => s.setExportDir);
  const activeMode = useUIStateStore(s => s.activeMode);
  const generalSettings = useGeneralSettingsStore();
  const setActiveExportProfileId = useGeneralSettingsStore(s => s.setActiveExportProfileId);
  const { handleExport, handlePickExportDir } = useImportExport();

  const defaultMergedName = (clips[0]?.originalName || "episode") + "_merged";
  const activeExportProfile = React.useMemo(
    () => getActiveExportProfile(generalSettings.exportProfiles, generalSettings.activeExportProfileId),
    [generalSettings.exportProfiles, generalSettings.activeExportProfileId]
  );
  const exportProfileOptions = React.useMemo(
    () =>
      generalSettings.exportProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name.trim() || "Untitled Profile",
        description: supportsClipMerge(profile.workflow)
          ? `${getExportProfileSummary(profile)} • ${profile.mergeEnabled ? "MERGE" : "CLIPS"}`
          : getExportProfileSummary(profile),
        icon: renderProfileIcon(profile),
      })),
    [generalSettings.exportProfiles]
  );

  const canMergeWithActiveProfile = supportsClipMerge(activeExportProfile.workflow) && activeExportProfile.mergeEnabled;

  const hasProgram = !!props.programClip;
  const hasSource = !!props.sourceClip;

  // Auto-switch to program when timeline is scrubbed/active (Only on initial load/presence)
  React.useEffect(() => {
    if (activeMode === "editor") {
      setActiveView("program");
    } else if (activeMode === "selector" && hasSource) {
      setActiveView("source");
    }
  }, [activeMode, hasSource, hasProgram]);

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
    const targetClips = activeView === "program" ? timelineClipIds : selectedClips;
    if (canMergeWithActiveProfile) {
      setShowMergeNameModal(true);
    } else {
      handleExport(targetClips, false);
    }
  };

  const confirmMergeExport = () => {
    const targetClips = activeView === "program" ? timelineClipIds : selectedClips;
    const value = (mergeNameInputRef.current?.value ?? "").trim();
    if (!value) return;
    setShowMergeNameModal(false);
    handleExport(targetClips, true, value);
  };

  return (
    <main  className="preview-container" >
      <div className="preview-view-switcher">
        <button 
          className={`switcher-btn ${activeView === "source" ? "active" : ""} ${!hasSource ? "disabled" : ""}`}
          onClick={() => hasSource && setActiveView("source")}
        >
          SOURCE
        </button>
        <button 
          className={`switcher-btn ${activeView === "program" ? "active" : ""} ${!hasProgram ? "disabled" : ""}`}
          onClick={() => hasProgram && setActiveView("program")}
        >
          PROGRAM
        </button>
      </div>

      <div className="preview-windows-layout single">
        {activeView === "source" && hasSource && (
          <div className="preview-window-wrapper source" key="source-wrapper">
            <div className="preview-window">
              <VideoPlayer 
                key={`source-player-${props.sourceClip}`}
                selectedClip={props.sourceClip!}
                videoIsHEVC={videoIsHEVC}
                userHasHEVC={userHasHEVC}
                posterPath={props.sourceClipThumbnail}
                importToken={importToken}
                onTimeUpdate={props.onTimeUpdate}
              />
            </div>
          </div>
        )}

        {activeView === "program" && hasProgram && (
          <div className="preview-window-wrapper program" key="program-wrapper">
            <div className="preview-window">
              <VideoPlayer 
                key={`program-player-${props.programClip}`}
                selectedClip={props.programClip!}
                videoIsHEVC={videoIsHEVC}
                userHasHEVC={userHasHEVC}
                posterPath={props.programClipThumbnail}
                importToken={importToken}
                externalTime={props.programTime}
                onTimeUpdate={props.onTimeUpdate}
              />
            </div>
          </div>
        )}

        {((activeView === "source" && !hasSource) || (activeView === "program" && !hasProgram) || (!hasSource && !hasProgram)) && (
          <div className="preview-window empty" key="empty-preview">
            <p>{activeView === "program" ? "Timeline is empty" : "No clip selected"}</p>
          </div>
        )}
      </div>
      <div className="export-panel">
        <div className="export-header">
          <FaFileExport className="header-icon" />
          <span className="export-title">EXPORT SETTINGS</span>
        </div>

        <div className="export-settings-row">
          <div className="export-setting-group export-profile-group">
            <label className="export-label">
              <FaTags className="label-icon" /> Export Profile
            </label>
            <Dropdown
              className="export-profile-select"
              options={exportProfileOptions}
              value={activeExportProfile.id}
              onChange={setActiveExportProfileId}
              preferredDirection="down"
            />
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
              value={exportDir || ""}
              onChange={(e) => setExportDir(e.target.value)}
            />
            <button
              className="buttons export-dir-browse"
              onClick={handlePickExportDir}
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
              defaultValue={defaultMergedName}
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
