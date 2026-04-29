import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { type GeneralSettings } from "../../settings/generalSettings";
import { useEffect, useState } from "react";

type GeneralSectionProps = {
  generalSettings: GeneralSettings;
  setGeneralSettings: React.Dispatch<React.SetStateAction<GeneralSettings>>;
  onGeneralSettingsReset: () => void;
  onEpisodesPathChanged: (oldPath: string, newPath: string) => void;
};

export default function GeneralSection({
  generalSettings,
  setGeneralSettings,
  onGeneralSettingsReset,
  onEpisodesPathChanged,
}: GeneralSectionProps) {
  const [loading, setLoading] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const factoryResetConfirmation =
    "This will restore AMVerge to its default settings and move your episode storage folder back to AppData. Any custom settings or storage location changes you made will be reset.";
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
    <section className="panel">
      <h3>General</h3>

      {loading && (
        <div className="settings-row">
          <span className="settings-value" style={{ color: "#ff0" }}>
            Moving episodes to new directory...
          </span>
        </div>
      )}

      <div className="settings-row">
        <label className="settings-label">Application Version</label>
        <div className="settings-control">
          <span className="settings-value" style={{ width: "auto" }}>
            v1.0.0
          </span>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        The current version of the AMVerge application.
      </p>

      <div className="settings-row">
        <label className="settings-label">Audio Playback Hover</label>
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
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Automatically play clip audio when hovering over items in the grid.
      </p>

      <div className="settings-row">
        <label className="settings-label">Playback Volume</label>
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
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Adjust the master volume level for clip previews and audio playback.
      </p>

      <div className="settings-row">
        <label className="settings-label">Episodes storage path</label>
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
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        The location where your processed episodes and clips are stored.
      </p>

      <div
        className="settings-row"
        style={{
          marginTop: "12px",
          paddingTop: "12px",
          borderTop: "1px solid rgb(255 255 255 / 0.1)",
        }}
      >
        <label className="settings-label">Factory Reset</label>
        <div className="settings-control">
          <button
            className="buttons"
            onClick={() => {
              setShowFactoryResetConfirm(true);
            }}
            style={{ width: "auto", padding: "0 16px", marginBottom: 0 }}
            disabled={loading}
          >
            Reset to Defaults
          </button>
        </div>
      </div>

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
    </section>
  );
}
