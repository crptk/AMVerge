import { useId, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import ColorPicker from "../common/ColorPicker";
import CropModal from "./CropModal";
import { useThemeSettingsStore, getDarkerColor } from "../../store/settingsStore";

export default function AppearanceSection() {
  const accentId = useId();
  const bgGradientId = useId();
  const bgOpacityId = useId();
  const bgBlurId = useId();

  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [originalPath, setOriginalPath] = useState<string | null>(null);

  const currentAccentColor = useThemeSettingsStore(s => s.accentColor);
  const currentBackgroundGradientColor = useThemeSettingsStore(s => s.backgroundGradientColor);
  const currentBackgroundImage = useThemeSettingsStore(s => s.backgroundImagePath);
  const currentBackgroundOpacity = useThemeSettingsStore(s => s.backgroundOpacity);
  const currentBackgroundBlur = useThemeSettingsStore(s => s.backgroundBlur);
  const currentShowDownloadButton = useThemeSettingsStore(s => s.showDownloadButton);



  const resetTheme = useThemeSettingsStore(s => s.resetThemeSettings);
  const setShowDownloadButton = useThemeSettingsStore(s => s.setShowDownloadButton);
  const setBackgroundBlur = useThemeSettingsStore(s => s.setBackgroundBlur);
  const setBackgroundImagePath = useThemeSettingsStore(s => s.setBackgroundImagePath);
  const setAccentColor = useThemeSettingsStore(s => s.setAccentColor);
  const setBackgroundGradientColor = useThemeSettingsStore(s => s.setBackgroundGradientColor);
  const setBackgroundOpacity = useThemeSettingsStore(s => s.setBackgroundOpacity);

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
    
    setOriginalPath(selected);
    setImageToCrop(convertFileSrc(selected));
  };

  const handleCropComplete = async (cropData: any) => {
    if (!originalPath) return;

    try {
      const storedPath = await invoke<string>("crop_and_save_image", {
        sourcePath: originalPath,
        crop: {
          x: cropData.x,
          y: cropData.y,
          width: cropData.width,
          height: cropData.height,
          rotation: cropData.rotation,
          flip_h: cropData.flip.horizontal,
          flip_v: cropData.flip.vertical,
        }
      });

      setBackgroundImagePath(`${storedPath}?t=${Date.now()}`);
      setImageToCrop(null);
      setOriginalPath(null);
    } catch (error) {
      console.error("Failed to crop and save image:", error);
    }
  };

  return (
    <section className="panel">
      <h3>Appearance</h3>
      <div className="settings-row">
        <label className="settings-label" htmlFor={accentId}>
          Accent color
        </label>
        <div className="settings-control">
          <ColorPicker
            color={currentAccentColor}
            onChange={(newColor) => {
              setAccentColor(newColor);
              setBackgroundGradientColor(getDarkerColor(newColor));
            }}
          />
          <span className="settings-value">{currentAccentColor.toUpperCase()}</span>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Customize the primary color used for buttons, highlights, and icons.
      </p>

      <div className="settings-row">
        <label className="settings-label" htmlFor={bgGradientId}>
          Background gradient
        </label>
        <div className="settings-control">
          <ColorPicker
            color={currentBackgroundGradientColor}
            onChange={(newColor) => { setBackgroundGradientColor(newColor); }}
          />
          <span className="settings-value">
            {currentBackgroundGradientColor.toUpperCase()}
          </span>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Choose the secondary color for the background gradient effect.
      </p>

      <div className="settings-row">
        <label className="settings-label">Background image</label>
        <div className="settings-control">
          <button className="buttons" type="button" onClick={handlePickImage}>
            {currentBackgroundImage ? "Change" : "Upload"}
          </button>
          <button
            className="buttons"
            type="button"
            onClick={() => { setBackgroundImagePath(null); } }
            disabled={!currentBackgroundImage}
          >
            Clear
          </button>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Upload a custom image to use as your application background.
      </p>

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
            value={currentBackgroundOpacity}
            onChange={(e) => { setBackgroundOpacity(parseFloat(e.target.value)); }}
          />
          <span className="settings-value">
            {Math.round(currentBackgroundOpacity * 100)}%
          </span>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Adjust the transparency of the background image.
      </p>

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
            value={currentBackgroundBlur}
            onChange={(e) => { setBackgroundBlur(parseInt(e.target.value)); }}
          />
          <span className="settings-value">{currentBackgroundBlur}px</span>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Apply a blur effect to the background image for better readability.
      </p>

      <div className="settings-row">
        <label className="settings-label">Show download button</label>
        <div className="settings-control">
          <label className="custom-checkbox">
            <input
              type="checkbox"
              className="checkbox"
              checked={currentShowDownloadButton}
              onChange={(e) => { setShowDownloadButton(e.target.checked); }}
            />
            <span className="checkmark"></span>
          </label>
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
            onClick={resetTheme}
            style={{ width: "auto", padding: "0 16px", marginBottom: 0 }}
          >
            Reset to Defaults
          </button>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "0" }}>
        Revert all appearance and theme settings back to their default values.
      </p>

      {imageToCrop && (
        <CropModal
          image={imageToCrop}
          onClose={() => setImageToCrop(null)}
          onCropComplete={handleCropComplete}
        />
      )}
    </section>
  );
}
