import { useId, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  getDarkerColor,
  isVideoBackgroundPath,
  useThemeSettingsStore,
} from "../../stores/settingsStore";
import ColorPicker from "../common/ColorPicker";
import CropModal from "../common/CropModal";
import SettingRow from "../common/SettingRow";

type AppearanceSectionProps = {
  onThemeReset: () => void;
};

export default function AppearanceSection({
  onThemeReset
}: AppearanceSectionProps) {
  const themeSettings = useThemeSettingsStore();
  const setThemeSettings = useThemeSettingsStore.setState;
  const bgOpacityId = useId();
  const bgBlurId = useId();
  const gridPreviewSpeedId = useId();

  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const cropRequestVersionRef = useRef(0);

  const handlePickBackgroundMedia = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Media",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "bmp",
            "tif",
            "tiff",
            "mp4",
            "webm",
            "mov",
            "mkv",
            "avi",
            "m4v",
          ],
        },
      ],
    });

    if (!selected || typeof selected !== "string") return;

    if (isVideoBackgroundPath(selected)) {
      try {
        const storedPath = await invoke<string>("save_background_image", {
          sourcePath: selected,
        });

        setThemeSettings((prev) => ({
          ...prev,
          backgroundImagePath: `${storedPath}?t=${Date.now()}`,
        }));
      } catch (error) {
        console.error("Failed to save background video:", error);
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Failed to apply background video: ${message}`);
      }

      return;
    }
    
    setOriginalPath(selected);
    setImageToCrop(convertFileSrc(selected));
  };

  const handleCloseCropModal = () => {
    cropRequestVersionRef.current += 1;
    setImageToCrop(null);
    setOriginalPath(null);
  };

  const handleCropComplete = async (cropData: any) => {
    if (!originalPath) return;

    const requestVersion = cropRequestVersionRef.current + 1;
    cropRequestVersionRef.current = requestVersion;

    try {
      const timeoutMs = 30000;
      const storedPath = await Promise.race([
        invoke<string>("crop_and_save_image", {
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
        }),
        new Promise<string>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Image apply timed out. Please try a smaller image."));
          }, timeoutMs);
        }),
      ]);

      if (cropRequestVersionRef.current !== requestVersion) {
        return;
      }

      setThemeSettings((prev) => ({
        ...prev,
        backgroundImagePath: `${storedPath}?t=${Date.now()}`,
      }));
      setImageToCrop(null);
      setOriginalPath(null);
    } catch (error) {
      console.error("Failed to crop and save image:", error);
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Failed to apply background image: ${message}`);
    }
  };

  return (
    <section className="panel menu-panel settings-panel">
      <h3>Appearance</h3>
      <div className="about-content">

        <SettingRow
          label="Accent color"
          description="Customize the primary color used for buttons, highlights, and icons."
          control={
            <div className="settings-control">
              <ColorPicker
                color={themeSettings.accentColor}
                onChange={(newColor) => {
                  setThemeSettings((prev) => {
                    const currentDark = getDarkerColor(prev.accentColor);
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
              />
              <span className="settings-value">
                {themeSettings.accentColor.toUpperCase()}
              </span>
            </div>
          }
        />
        <SettingRow
          label="Background Gradient"
          description="Choose the secondary color for the background gradient effect."
          control={
            <div className="settings-control">
              <ColorPicker
                color={themeSettings.backgroundGradientColor}
                onChange={(newColor) =>
                  setThemeSettings((prev) => ({
                    ...prev,
                    backgroundGradientColor: newColor,
                  }))
                }
              />
              <span className="settings-value">
                {themeSettings.backgroundGradientColor.toUpperCase()}
              </span>
            </div>
          }
        />

        <SettingRow
          label="Background media"
          description="Upload a custom image, GIF, or video to use as your application background."
          control={
          <div className="settings-control">
            <button className="buttons" type="button" onClick={handlePickBackgroundMedia}>
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
          }
        />
        
        <SettingRow
          label="Background opacity"
          description="Adjust the transparency of the background image."
          control={
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
          }
        />

        <SettingRow
          label="Background blur"
          description="Adjust the blur of the background image."
          control={
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
          }
        />

        <SettingRow
          label="Grid preview speed"
          description="Adjust how fast video previews play in the clips grid."
          control={
            <div className="settings-control">
              <input
                id={gridPreviewSpeedId}
                type="range"
                min="0.25"
                max="3"
                step="0.05"
                value={themeSettings.gridPreviewSpeed ?? 1}
                onChange={(e) =>
                  setThemeSettings((prev) => ({
                    ...prev,
                    gridPreviewSpeed: parseFloat(e.target.value),
                  }))
                }
              />
              <span className="settings-value">{(themeSettings.gridPreviewSpeed ?? 1).toFixed(2)}x</span>
            </div>
          }
        />

        <SettingRow
          label="Show download button"
          description="Toggle download button visibility on the clips."
          control={
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={themeSettings.showDownloadButton}
                  onChange={(e) =>
                    setThemeSettings((prev) => ({
                      ...prev,
                      showDownloadButton: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          }
        />

        <SettingRow
          label="Show clip timestamps"
          description="Toggle timestamp visibility on the clips."
          control={
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={themeSettings.showClipTimestamps}
                  onChange={(e) =>
                    setThemeSettings((prev) => ({
                      ...prev,
                      showClipTimestamps: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          }
        />

        <SettingRow
          label="Widescreen clip tiles"
          description="Switch clip tiles between square (1080x1080) and widescreen (1920x1080)."
          control={
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={themeSettings.widescreenClipTiles ?? false}
                  onChange={(e) =>
                    setThemeSettings((prev) => ({
                      ...prev,
                      widescreenClipTiles: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          }
        />
        <SettingRow
          label="Factory Reset"
          description="Revert all appearance and theme settings back to their default values."
          control={
            <div className="settings-control">
              <button
                className="buttons emergency"
                onClick={onThemeReset}
                style={{ width: "auto", padding: "0 16px", marginBottom: 0, color: "red"}}
              >
                Reset to Defaults
              </button>
            </div>
          }
        />

        {imageToCrop && (
          <CropModal
            image={imageToCrop}
            onClose={handleCloseCropModal}
            onCropComplete={handleCropComplete}
          />
        )}
      </div>
    </section>
  );
}
