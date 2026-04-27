import { open } from "@tauri-apps/plugin-dialog";
import { type ThemeSettings } from "../../theme";

type GeneralSectionProps = {
  settings: ThemeSettings;
  setSettings: React.Dispatch<React.SetStateAction<ThemeSettings>>;
  onReset: () => void;
};

export default function GeneralSection({
  settings,
  setSettings,
  onReset,
}: GeneralSectionProps) {
  const handlePickDir = async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Select Episodes Storage Directory",
    });

    if (selected && typeof selected === "string") {
      setSettings((prev) => ({ ...prev, episodesPath: selected }));
    }
  };

  return (
    <section className="settings-section">
      <h3>General</h3>
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
          <button className="buttons" type="button" onClick={handlePickDir}>
            {settings.episodesPath ? "Change" : "Select Path"}
          </button>
          <span
            className="settings-value"
            style={{
              width: "auto",
              maxWidth: "250px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "12px",
              opacity: 0.6,
            }}
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
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </section>
  );
}
