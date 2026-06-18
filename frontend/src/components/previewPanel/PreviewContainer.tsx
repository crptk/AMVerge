import HowToUse from "./HowToUse.tsx"
import React from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
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
import { useEpisodePanelRuntimeStore } from "../../stores/episodeStore.ts";
import { useScenePreviewStore } from "../../stores/scenePreviewStore.ts";
import useImportExport from "../../hooks/useImportExport";
import { renderProfileIcon } from "../../features/export/profileIconUtils.tsx";
import {
  getActiveExportProfile,
  getExportProfileSummary,
} from "../../features/export/profiles.ts";

type PreviewAudioStream = {
  audioStreamIndex: number;
  label: string;
};

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
  const importedVideoPath = useAppStateStore(s => s.importedVideoPath);
  const focusedClipId = useAppStateStore(s => s.focusedClipId);

  const importToken = useAppStateStore(s => s.importToken);
  const exportDir = useAppPersistedStore(s => s.exportDir);
  const setExportDir = useAppPersistedStore(s => s.setExportDir);
  const setActivePage = useUIStateStore(s => s.setActivePage);
  const setSettingsTab = useUIStateStore(s => s.setSettingsTab);
  const generalSettings = useGeneralSettingsStore();
  const setActiveExportProfileId = useGeneralSettingsStore(s => s.setActiveExportProfileId);
  const mergeClipsEnabled = useGeneralSettingsStore(s => s.mergeClipsEnabled);
  const setMergeClipsEnabled = useGeneralSettingsStore(s => s.setMergeClipsEnabled);
  const previewAudioStreamIndex = useGeneralSettingsStore(s => s.previewAudioStreamIndex);
  const setPreviewAudioStreamIndex = useGeneralSettingsStore(s => s.setPreviewAudioStreamIndex);
  const importMethod = useGeneralSettingsStore(s => s.importMethod);
  const { handleExport, handlePickExportDir } = useImportExport();
  const [audioStreams, setAudioStreams] = React.useState<PreviewAudioStream[]>([]);
  const webpPreviewMode = importMethod === "webp_files";

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

  const audioStreamOptions = React.useMemo(
    () =>
      audioStreams.map((stream) => ({
        value: stream.audioStreamIndex,
        label: stream.label,
      })),
    [audioStreams]
  );

  const hasSelectedClips = selectedClips.size > 0;

  const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  const animatedByClipId = useScenePreviewStore(s => s.animatedByClipId);

  const sourceClipObj = React.useMemo(
    () => (focusedClipId ? clips.find(c => c.id === focusedClipId) ?? null : null),
    [clips, focusedClipId]
  );
  const hasSource = !!props.sourceClip && !!sourceClipObj;

  const previewImageSrc = focusedClipId ? (animatedByClipId[focusedClipId] ?? null) : null;

  // Source-anchored time window for the focused scene (mirrors the grid's WebP window).
  const sourcePath = sourceClipObj ? (sourceClipObj.originalPath || sourceClipObj.src) : null;
  const sceneStart =
    typeof sourceClipObj?.startSec === "number"
      ? sourceClipObj.startSec
      : typeof sourceClipObj?.start === "number"
        ? sourceClipObj.start
        : 0;
  const sceneRawEnd =
    typeof sourceClipObj?.endSec === "number"
      ? sourceClipObj.endSec
      : typeof sourceClipObj?.end === "number"
        ? sourceClipObj.end
        : sceneStart + 2;
  const sceneEnd = Math.min(sceneRawEnd > sceneStart ? sceneRawEnd : sceneStart + 2, sceneStart + 2.5);

  // Generate the animated WebP for the focused clip on demand (never play the original video).
  React.useEffect(() => {
    if (!focusedClipId || !sourcePath || previewImageSrc) return;
    let cancelled = false;
    invoke<{ path?: string }>("generate_scene_webp", {
      sceneId: focusedClipId,
      sourcePath,
      start: sceneStart,
      end: sceneEnd,
      fps: 8,
      episodeCacheId: openedEpisodeId ?? null,
      customPath: generalSettings.episodesPath ?? null,
      kind: "animated",
    })
      .then((res) => {
        if (cancelled || !res?.path) return;
        useScenePreviewStore.getState().setAnimated(focusedClipId, res.path);
      })
      .catch(() => {
        // best-effort; poster (if any) remains shown
      });
    return () => {
      cancelled = true;
    };
  }, [focusedClipId, sourcePath, previewImageSrc, sceneStart, sceneEnd, openedEpisodeId, generalSettings.episodesPath]);

  React.useEffect(() => {
    if (showMergeNameModal) {
      requestAnimationFrame(() => {
        mergeNameInputRef.current?.focus();
        mergeNameInputRef.current?.select();
      });
    }
  }, [showMergeNameModal]);

  React.useEffect(() => {
    if (!importedVideoPath) {
      setAudioStreams([]);
      return;
    }

    let cancelled = false;

    invoke<PreviewAudioStream[]>("get_audio_streams", { videoPath: importedVideoPath })
      .then((streams) => {
        if (cancelled) return;
        setAudioStreams(streams ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("get_audio_streams failed", err);
        setAudioStreams([]);
      });

    return () => {
      cancelled = true;
    };
  }, [importedVideoPath]);

  React.useEffect(() => {
    if (audioStreams.length === 0) {
      if (previewAudioStreamIndex !== null) {
        setPreviewAudioStreamIndex(null);
      }
      return;
    }

    if (previewAudioStreamIndex === null) {
      setPreviewAudioStreamIndex(audioStreams[0].audioStreamIndex);
      return;
    }

    if (!audioStreams.some((stream) => stream.audioStreamIndex === previewAudioStreamIndex)) {
      setPreviewAudioStreamIndex(audioStreams[0].audioStreamIndex);
    }
  }, [audioStreams, previewAudioStreamIndex, setPreviewAudioStreamIndex]);

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
              {previewImageSrc ? (
                <img
                  className="preview-webp"
                  src={`${convertFileSrc(previewImageSrc)}?v=${importToken}`}
                  draggable={false}
                  onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  alt=""
                />
              ) : (
                <div className="preview-window empty">
                  <p>Loading preview...</p>
                </div>
              )}
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
            <div className="export-dir-item">
              <span className="audio-stream-label" aria-hidden="true">
                <span>MERGE</span>
                <span>CLIPS</span>
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
            <div className="export-dir-item">
              <div className="audio-stream-field" aria-label="Preview language selector">
                <span className="audio-stream-label" aria-hidden="true">
                  <span>PREVIEW</span>
                  <span>LANGUAGE</span>
                </span>

                <Dropdown
                  className="export-profile-select audio-stream-select"
                  options={audioStreamOptions}
                  value={previewAudioStreamIndex ?? (audioStreams[0]?.audioStreamIndex ?? 0)}
                  onChange={setPreviewAudioStreamIndex}
                  preferredDirection="up"
                  disabled={audioStreamOptions.length === 0 || webpPreviewMode}
                />
              </div>
            </div>
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
