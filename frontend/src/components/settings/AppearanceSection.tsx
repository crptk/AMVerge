import { useId } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getDarkerColor, type ThemeSettings } from "../../settings/themeSettings";

type AppearanceSectionProps = {
  themeSettings: ThemeSettings;
  setThemeSettings: React.Dispatch<React.SetStateAction<ThemeSettings>>;
  onThemeReset: () => void;
};

export default function AppearanceSection({
  themeSettings,
  setThemeSettings,
  onThemeReset
}: AppearanceSectionProps) {
  const accentId = useId();
  const bgGradientId = useId();
  const bgOpacityId = useId();
  const bgBlurId = useId();

  const handlePickImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Image",
          extensions: ["png", "jpg", "jpeg", "webp", "gif"],
        },
      ],
    });

    if (!selected || typeof selected !== "string") return;

    try {
      const storedPath = await invoke<string>("save_background_image", {
        sourcePath: selected,
      });

      setThemeSettings((prev) => ({
        ...prev,
        backgroundImagePath: storedPath,
      }));
    } catch (error) {
      console.error("Failed to save background image:", error);
    }
  };

  return (
    <section className="settings-section">
      <h3>Appearance</h3>
      <div className="settings-row">
        <label className="settings-label" htmlFor={accentId}>
          Accent color
        </label>
        <div className="settings-control">
          <input
            id={accentId}
            type="color"
            value={themeSettings.accentColor}
            onChange={(e) => {
              const newColor = e.target.value;
              setThemeSettings((prev) => {
                const currentDark = getDarkerColor(prev.accentColor);
                // Sync if gradient is the default dark green or matches the current darkened accent
                const isDefaultGradient =
                  prev.backgroundGradientColor === "#001a00" ||
                  prev.backgroundGradientColor === currentDark;

                return {
                  ...prev,
                  accentColor: newColor,
                  backgroundGradientColor: isDefaultGradient
                    ? getDarkerColor(newColor)
                    : prev.backgroundGradientColor,
                };
              });
            }}
            aria-label="Accent color"
          />
          <span className="settings-value">{themeSettings.accentColor.toUpperCase()}</span>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor={bgGradientId}>
          Background gradient
        </label>
        <div className="settings-control">
          <input
            id={bgGradientId}
            type="color"
            value={themeSettings.backgroundGradientColor}
            onChange={(e) =>
              setThemeSettings((prev) => ({
                ...prev,
                backgroundGradientColor: e.target.value,
              }))
            }
            aria-label="Background gradient color"
          />
          <span className="settings-value">
            {themeSettings.backgroundGradientColor.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label">Background image</label>
        <div className="settings-control">
          <button className="buttons" type="button" onClick={handlePickImage}>
            {themeSettings.backgroundImagePath ? "Change" : "Upload"}
          </button>
          <button
            className="buttons"
            type="button"
            onClick={() =>
              setThemeSettings((prev) => ({ ...prev, backgroundImagePath: null }))
            }
            disabled={!themeSettings.backgroundImagePath}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor={bgOpacityId}>
          Background opacity
        </label>
        <div className="settings-control">
          <input
            id={bgOpacityId}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={themeSettings.backgroundOpacity}
            onChange={(e) =>
              setThemeSettings((prev) => ({
                ...prev,
                backgroundOpacity: parseFloat(e.target.value),
              }))
            }
          />
          <span className="settings-value">
            {Math.round(themeSettings.backgroundOpacity * 100)}%
          </span>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor={bgBlurId}>
          Background blur
        </label>
        <div className="settings-control">
          <input
            id={bgBlurId}
            type="range"
            min="0"
            max="100"
            step="1"
            value={themeSettings.backgroundBlur}
            onChange={(e) =>
              setThemeSettings((prev) => ({
                ...prev,
                backgroundBlur: parseInt(e.target.value),
              }))
            }
          />
          <span className="settings-value">{themeSettings.backgroundBlur}px</span>
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
            onClick={onThemeReset}
            style={{ width: "auto", padding: "0 16px", marginBottom: 0 }}
            // disabled={loading}
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </section>
  );
}
