import { useEffect, useId, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  applyThemeSettings,
  loadThemeSettings,
  saveThemeSettings,
  type ThemeSettings,
} from "../../theme";

export default function AppearanceSection() {
  const accentId = useId();
  const bgGradientId = useId();
  const bgOpacityId = useId();
  const bgBlurId = useId();

  const [settings, setSettings] = useState<ThemeSettings>(() => loadThemeSettings());

  useEffect(() => {
    applyThemeSettings(settings);
    saveThemeSettings(settings);
  }, [settings]);

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

      setSettings((prev) => ({
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
            value={settings.accentColor}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, accentColor: e.target.value }))
            }
            aria-label="Accent color"
          />
          <span className="settings-value">{settings.accentColor.toUpperCase()}</span>
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
            value={settings.backgroundGradientColor}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                backgroundGradientColor: e.target.value,
              }))
            }
            aria-label="Background gradient color"
          />
          <span className="settings-value">
            {settings.backgroundGradientColor.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="settings-row">
        <label className="settings-label">Background image</label>
        <div className="settings-control">
          <button className="buttons" type="button" onClick={handlePickImage}>
            {settings.backgroundImagePath ? "Change" : "Upload"}
          </button>
          <button
            className="buttons"
            type="button"
            onClick={() =>
              setSettings((prev) => ({ ...prev, backgroundImagePath: null }))
            }
            disabled={!settings.backgroundImagePath}
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
            value={settings.backgroundOpacity}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                backgroundOpacity: parseFloat(e.target.value),
              }))
            }
          />
          <span className="settings-value">
            {Math.round(settings.backgroundOpacity * 100)}%
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
            value={settings.backgroundBlur}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                backgroundBlur: parseInt(e.target.value),
              }))
            }
          />
          <span className="settings-value">{settings.backgroundBlur}px</span>
        </div>
      </div>
    </section>
  );
}
