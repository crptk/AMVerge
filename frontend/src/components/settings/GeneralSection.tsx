import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { type GeneralSettings } from "../../settings/generalSettings";
import { useState } from "react";

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
    <section className="settings-section">
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
            onClick={onGeneralSettingsReset}
            style={{ width: "auto", padding: "0 16px", marginBottom: 0 }}
            disabled={loading}
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </section>
  );
}