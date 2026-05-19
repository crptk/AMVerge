import VideoPlayer from "./videoPlayer/VideoPlayer.tsx"
import HowToUse from "./HowToUse.tsx"
import React from "react";
import {
  FaFolderOpen,
  FaFileExport,
  FaPencilAlt,
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
} from "../../features/export/profiles.ts";
type PreviewContainerProps = {
  sourceClip: string | null;
  sourceClipThumbnail: string | null;
  onTimeUpdate?: (time: number) => void;
};

export default function PreviewContainer(props: PreviewContainerProps) {
  const [showMergeNameModal, setShowMergeNameModal] = React.useState(false);
  const mergeNameInputRef = React.useRef<HTMLInputElement | null>(null);

  const clips = useAppStateStore(s => s.clips);
  const selectedClips = useAppStateStore(s => s.selectedClips);

  const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
  const userHasHEVC = useAppStateStore(s => s.userHasHEVC);
  const importToken = useAppStateStore(s => s.importToken);
  const exportDir = useAppPersistedStore(s => s.exportDir);
  const setExportDir = useAppPersistedStore(s => s.setExportDir);
  const setActivePage = useUIStateStore(s => s.setActivePage);
  const setSettingsTab = useUIStateStore(s => s.setSettingsTab);
  const generalSettings = useGeneralSettingsStore();
  const setActiveExportProfileId = useGeneralSettingsStore(s => s.setActiveExportProfileId);
  const mergeClipsEnabled = useGeneralSettingsStore(s => s.mergeClipsEnabled);
  const setMergeClipsEnabled = useGeneralSettingsStore(s => s.setMergeClipsEnabled);
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
        description: getExportProfileSummary(profile),
        icon: renderProfileIcon(profile),
      })),
    [generalSettings.exportProfiles]
  );

  const hasSelectedClips = selectedClips.size > 0;

  const sourceClipObj = props.sourceClip ? clips.find(c => c.src === props.sourceClip) : null;
  const mergedSrcs = sourceClipObj?.mergedSrcs;
  const hasSource = !!props.sourceClip;

  React.useEffect(() => {
    if (showMergeNameModal) {
      requestAnimationFrame(() => {
        mergeNameInputRef.current?.focus();
        mergeNameInputRef.current?.select();
      });
    }
  }, [showMergeNameModal]);

  const onExportClick = () => {
    if (!hasSelectedClips) return;
    const targetClips = selectedClips;
    if (mergeClipsEnabled) {
      setShowMergeNameModal(true);
    } else {
      handleExport(targetClips, false);
    }
  };

  const confirmMergeExport = () => {
    const targetClips = selectedClips;
    const value = (mergeNameInputRef.current?.value ?? "").trim();
    if (!value) return;
    setShowMergeNameModal(false);
    handleExport(targetClips, true, value);
  };

  return (
    <main className="preview-container" >
      <div className="preview-windows-layout single">
        {hasSource && (
          <div className="preview-window-wrapper source" key="source-wrapper">
            <div className="preview-window">
              <VideoPlayer
                key={`source-player-${props.sourceClip}`}
                selectedClip={props.sourceClip!}
                mergedSrcs={mergedSrcs}
                videoIsHEVC={videoIsHEVC}
                userHasHEVC={userHasHEVC}
                posterPath={props.sourceClipThumbnail}
                importToken={importToken}
                onTimeUpdate={props.onTimeUpdate}
              />
            </div>
          </div>
        )}

        {!hasSource && (
          <div className="preview-window empty" key="empty-preview">
            <p>No clip selected</p>
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
            </label>
            <div className="export-dir-row">
              <Dropdown
                className="export-profile-select"
                options={exportProfileOptions}
                value={activeExportProfile.id}
                onChange={setActiveExportProfileId}
                preferredDirection="down"
              />
              <button
                className="buttons export-dir-browse"
                onClick={() => { setSettingsTab("export"); setActivePage("settings"); }}
                title="Edit export settings"
              >
                <FaPencilAlt />
              </button>
            </div>
          </div>
        </div>

        <div className="export-path-section">
          <label className="export-label">
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

        <div>
          <div className="export-dir-row">
            <span className="merge-clips-input" style={{ display: "flex", alignItems: "center" }}>
              Merge Clips
            </span>
            <label className="custom-checkbox" aria-label="Merge clips">
              <input
                type="checkbox"
                className="checkbox"
                checked={mergeClipsEnabled}
                onChange={(event) => setMergeClipsEnabled(event.target.checked)}
              />
              <span className="checkmark" />
            </label>
          </div>
        </div>

        <button
          className="buttons export-main-button"
          disabled={!hasSelectedClips}
          onClick={onExportClick}
          title={!hasSelectedClips ? "Select at least one clip to export" : "Export selected clips"}
        >
          Export Now
        </button>
      </div>

      <HowToUse />

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
