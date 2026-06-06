import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useGeneralSettingsStore } from "../../stores/settingsStore";
import { useEffect, useState} from "react";
import SettingRow from "../common/SettingRow";
import { clearEpisodePanelCache } from "../../utils/episodeUtils";

type GeneralSettingsProps = {
  onGeneralSettingsReset: () => void;
  onEpisodesPathChanged: (oldPath: string, newPath: string) => void;
};

export default function GeneralSettings({
  onGeneralSettingsReset,
  onEpisodesPathChanged,
}: GeneralSettingsProps) {
  const generalSettings = useGeneralSettingsStore();
  const setGeneralSettings = useGeneralSettingsStore.setState;
  const [loading, setLoading] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [showClearPanelConfirm, setShowClearPanelConfirm] = useState(false);
  const [clearingPanel, setClearingPanel] = useState(false);
  const factoryResetConfirmation =
    "This will restore AMVerge to its default settings and move your episode storage folder back to AppData. Any custom settings or storage location changes you made will be reset.";
  const clearPanelConfirmation =
    "This will remove ALL episodes from the Episode Panel and move cached files to Recycle Bin/Trash. This action can affect many files in your episode cache folder.";
  useEffect(() => {
    if (!showFactoryResetConfirm) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowFactoryResetConfirm(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showFactoryResetConfirm]);

  useEffect(() => {
    if (!showClearPanelConfirm) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowClearPanelConfirm(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showClearPanelConfirm]);

  const runClearEpisodePanelInBackground = async () => {
    try {
      await clearEpisodePanelCache();
    } catch (err) {
    } finally {
      setClearingPanel(false);
    }
  };

  const handleClearEpisodePanel = () => {
    setClearingPanel(true);
    setShowClearPanelConfirm(false);
    void runClearEpisodePanelInBackground();
  };

  const handlePickDir = async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Select Episodes Storage Directory",
    });

    if (selected && typeof selected === "string") {
      if (generalSettings.episodesPath !== selected) {
        setLoading(true);

        try {
          const resolvedOldPath = await invoke<string>("move_episodes_to_new_dir", {
            oldDir: generalSettings.episodesPath,
            newDir: selected,
          });

          onEpisodesPathChanged(resolvedOldPath, selected);
          
          setGeneralSettings((prev) => ({ ...prev, episodesPath: selected }));
        } catch (err) {
          window.alert("Failed to move existing episodes: " + String(err));
        } finally {
          setLoading(false);
        }
      }
    }
  };

  return (
    <section className="panel menu-panel settings-panel">
      <h3>General</h3>
      <div className="about-content">
        <SettingRow
          label="Application Version"
          description=""
          control={
          <div className="settings-control">
            <span className="settings-value" style={{ width: "auto" }}>
              v1.2.3
            </span>
          </div>
          }
        />
      
        <SettingRow
          label="Audio Playback Hover"
          description="Automatically play clip audio when hovering over items in the grid."
          control={
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={generalSettings.audioPlaybackHover}
                  onChange={(e) =>
                    setGeneralSettings((prev) => ({
                      ...prev,
                      audioPlaybackHover: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          }
        />

        <SettingRow
          label="Playback Volume"
          description="Adjust the master volume level for clip previews and audio playback."
          control={
            <div className="settings-control">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={generalSettings.playbackVolume}
                onChange={(e) =>
                  setGeneralSettings((prev) => ({
                    ...prev,
                    playbackVolume: parseFloat(e.target.value),
                  }))
                }
              />
              <span className="settings-value">
                {Math.round(generalSettings.playbackVolume * 100)}%
              </span>
            </div>
          }
        />

        <SettingRow
          label="Episodes Storage Path"
          description="The location where your processed episodes and clips are stored."
          control={
            <div className="settings-control">
              <button
                className="buttons"
                type="button"
                onClick={handlePickDir}
                disabled={loading}
              >
                {generalSettings.episodesPath ? "Change" : "Select Path"}
              </button>
              <span
                className="settings-path-value"
                title={generalSettings.episodesPath || "Default (App Data)"}
              >
                {generalSettings.episodesPath || "Default (App Data)"}
              </span>
            </div>
          }
        />

        <SettingRow
          label="Clear Episode Panel"
          description="Remove all episodes from the panel and move their cached files to Recycle Bin/Trash."
          control={
            <div className="settings-control">
              <button
                className="buttons emergency"
                type="button"
                onClick={() => setShowClearPanelConfirm(true)}
                style={{ width: "auto", padding: "0 16px", marginBottom: 0, color: "red" }}
                disabled={loading || clearingPanel}
              >
                {clearingPanel ? "Clearing..." : "Clear Episode Panel"}
              </button>
            </div>
          }
        />

        <SettingRow
          label="Factory Reset"
          description="Reset to Defaults"
          control={
            <div className="settings-control">
              <button
                className="buttons emergency"
                onClick={() => {
                  setShowFactoryResetConfirm(true);
                }}
                style={{ width: "auto", padding: "0 16px", marginBottom: 0, color: "red" }}
                disabled={loading}
              >
                Reset to Defaults
              </button>
            </div>
          }
        />

        {showFactoryResetConfirm && (
          <div
            className="episode-modal-overlay"
            onMouseDown={() => setShowFactoryResetConfirm(false)}
          >
            <div className="episode-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="episode-modal-title">Factory Reset</div>
              <div className="episode-modal-message">{factoryResetConfirmation}</div>
              <div className="episode-modal-actions">
                <button
                  type="button"
                  className="episode-modal-btn"
                  onClick={() => setShowFactoryResetConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="episode-modal-btn primary"
                  onClick={() => {
                    setShowFactoryResetConfirm(false);
                    void onGeneralSettingsReset();
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {showClearPanelConfirm && (
          <div
            className="episode-modal-overlay"
            onMouseDown={() => {
              if (!clearingPanel) setShowClearPanelConfirm(false);
            }}
          >
            <div className="episode-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="episode-modal-title">Clear Episode Panel</div>
              <div className="episode-modal-message">{clearPanelConfirmation}</div>
              <div className="episode-modal-actions">
                <button
                  type="button"
                  className="episode-modal-btn"
                  onClick={() => setShowClearPanelConfirm(false)}
                  disabled={clearingPanel}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="episode-modal-btn primary"
                  onClick={() => {
                    handleClearEpisodePanel();
                  }}
                  disabled={clearingPanel}
                >
                  {clearingPanel ? "Clearing..." : "Clear Episode Panel"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
