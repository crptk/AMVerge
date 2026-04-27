import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { type ThemeSettings } from "../../theme";
import { useState } from "react";

type GeneralSectionProps = {
  settings: ThemeSettings;
  setSettings: React.Dispatch<React.SetStateAction<ThemeSettings>>;
  onReset: () => void;
  onEpisodesPathChanged: (oldPath: string, newPath: string) => void;
};

export default function GeneralSection({
  settings,
  setSettings,
  onReset,
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
      if (settings.episodesPath !== selected) {
        setLoading(true);

        try {
          const resolvedOldPath = await invoke<string>("move_episodes_to_new_dir", {
            oldDir: settings.episodesPath,
            newDir: selected,
          });

          onEpisodesPathChanged(resolvedOldPath, selected);
          
          setSettings((prev) => ({ ...prev, episodesPath: selected }));
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
        <label className="settings-label">Episodes storage path</label>
        <div className="settings-control">
          <button
            className="buttons"
            type="button"
            onClick={handlePickDir}
            disabled={loading}
          >
            {settings.episodesPath ? "Change" : "Select Path"}
          </button>

          <span
            className="settings-path-value"
            title={settings.episodesPath || "Default (App Data)"}
          >
            {settings.episodesPath || "Default (App Data)"}
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
            onClick={onReset}
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