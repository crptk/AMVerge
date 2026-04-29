import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useGeneralSettingsStore } from "../../store/settingsStore";

type GeneralSectionProps = {
  onEpisodesPathChanged: (oldPath: string, newPath: string) => void;
};

export default function GeneralSection({
  onEpisodesPathChanged,
}: GeneralSectionProps) {
  const [loading, setLoading] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const factoryResetConfirmation =
    "This will restore AMVerge to its default settings and move your episode storage folder back to AppData. Any custom settings or storage location changes you made will be reset.";

  const episodesPath = useGeneralSettingsStore(s => s.episodesPath);
  const setepisodesPath = useGeneralSettingsStore(s => s.setEpisodesPath);
  
  const audioPlaybackHover = useGeneralSettingsStore(s => s.audioPlaybackHover);
  const setAudioPlaybackHover = useGeneralSettingsStore(s => s.setAudioPlaybackHover);
  
  const playbackVolume = useGeneralSettingsStore(s => s.playbackVolume);
  const setPlaybackVolume = useGeneralSettingsStore(s => s.setPlaybackVolume);
  
  const resetGeneralSettings = useGeneralSettingsStore(s => s.resetGeneralSettings);

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
      if (episodesPath !== selected) {
        setLoading(true);

        try {
          const resolvedOldPath = await invoke<string>("move_episodes_to_new_dir", {
            oldDir: episodesPath,
            newDir: selected,
          });

          onEpisodesPathChanged(resolvedOldPath, selected);
          
          setepisodesPath(selected)
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
              checked={audioPlaybackHover}
              onChange={(e) =>
                {
                  setAudioPlaybackHover(e.target.checked);
                }
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
            value={playbackVolume}
            onChange={(e) =>
              {
                setPlaybackVolume(parseFloat(e.target.value));
              }
            }
          />
          <span className="settings-value">
            {Math.round(playbackVolume * 100)}%
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
            {episodesPath ? "Change" : "Select Path"}
          </button>
          <span
            className="settings-path-value"
            title={episodesPath || "Default (App Data)"}
          >
            {episodesPath || "Default (App Data)"}
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
                  resetGeneralSettings();
                  setShowFactoryResetConfirm(false);
                  }
                }
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
