import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaEllipsisH,
  FaPlus,
  FaThumbtack,
} from "react-icons/fa";
import CropModal from "../../common/CropModal"
import {
  EXPORT_PROFILE_ICON_OPTIONS,
  type ExportProfile,
  type ExportProfileIcon,
} from "../../../features/export/profiles";
import { renderProfileIcon } from "../../../features/export/profileIconUtils";

const FEATURED_PROFILE_ICONS_KEY = "amverge.featuredProfileIcons";
const MAX_INLINE_VISIBLE_ICON_COUNT = 8;
const MAX_FEATURED_ICONS = 8;

const INLINE_DEFAULT_ICONS: ExportProfileIcon[] = [
  "video",
  "remux",
  "h264",
  "h265",
  "prores",
];

const ICON_FILE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
];

type PersistedFeaturedIcons = {
  builtIn: ExportProfileIcon[];
  custom: string[];
};

type CropModalPayload = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flip: {
    horizontal: boolean;
    vertical: boolean;
  };
};

type ProfileIconPickerProps = {
  activeProfile: ExportProfile;
  customProfileIcons: string[];
  addCustomProfileIcon: (iconPath: string) => void;
  removeCustomProfileIcon: (iconPath: string) => void;
  updateActiveProfile: (changes: Partial<ExportProfile>) => void;
};

function normalizeIconPath(path: string | null | undefined): string {
  return (path || "").split("?")[0];
}

function stampIconPath(path: string): string {
  return `${normalizeIconPath(path)}?t=${Date.now()}`;
}

function getInlineVisibleIconCount(viewportWidth: number): number {
  if (viewportWidth <= 960) return 5;
  if (viewportWidth <= 1160) return 6;
  if (viewportWidth <= 1360) return 7;
  return MAX_INLINE_VISIBLE_ICON_COUNT;
}

function getCurrentInlineVisibleIconCount(): number {
  if (typeof window === "undefined") return MAX_INLINE_VISIBLE_ICON_COUNT;
  return getInlineVisibleIconCount(window.innerWidth);
}

function ProfileIconGlyph({
  icon,
  customIconPath,
}: {
  icon: ExportProfileIcon;
  customIconPath?: string | null;
}) {
  return renderProfileIcon({ icon, customIconPath });
}

export default function ProfileIconPicker({
  activeProfile,
  customProfileIcons,
  addCustomProfileIcon,
  removeCustomProfileIcon,
  updateActiveProfile,
}: ProfileIconPickerProps) {
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [featuredIcons, setFeaturedIcons] = useState<ExportProfileIcon[]>([]);
  const [featuredCustomIcons, setFeaturedCustomIcons] = useState<string[]>([]);
  const [inlineVisibleIconCount, setInlineVisibleIconCount] = useState(
    getCurrentInlineVisibleIconCount
  );
  const [iconToCrop, setIconToCrop] = useState<string | null>(null);
  const [sourceIconPath, setSourceIconPath] = useState<string | null>(null);

  const iconPickerRef = useRef<HTMLDivElement | null>(null);

  const pickerIconOptions = useMemo(
    () => EXPORT_PROFILE_ICON_OPTIONS.filter((option) => option.value !== "custom"),
    []
  );

  const availableIconValues = useMemo(
    () => pickerIconOptions.map((option) => option.value),
    [pickerIconOptions]
  );

  const availableIconSet = useMemo(
    () => new Set(availableIconValues),
    [availableIconValues]
  );

  const normalizedActiveCustomIconPath = useMemo(
    () => normalizeIconPath(activeProfile.customIconPath),
    [activeProfile.customIconPath]
  );

  const normalizedCustomProfileIcons = useMemo(() => {
    const seen = new Set<string>();
    const deduped: string[] = [];
    const candidates = [...customProfileIcons, activeProfile.customIconPath || ""];

    for (const rawPath of candidates) {
      const normalized = normalizeIconPath(rawPath);
      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      deduped.push(normalized);
    }

    return deduped;
  }, [activeProfile.customIconPath, customProfileIcons]);

  const normalizedCustomProfileIconSet = useMemo(
    () => new Set(normalizedCustomProfileIcons),
    [normalizedCustomProfileIcons]
  );

  const saveFeaturedIcons = (
    nextBuiltIn: ExportProfileIcon[],
    nextCustom: string[]
  ) => {
    const builtInSeen = new Set<ExportProfileIcon>();
    const customSeen = new Set<string>();
    const validBuiltIn: ExportProfileIcon[] = [];
    const validCustom: string[] = [];

    for (const icon of nextBuiltIn) {
      if (!availableIconSet.has(icon) || builtInSeen.has(icon)) continue;

      builtInSeen.add(icon);
      validBuiltIn.push(icon);

      if (validBuiltIn.length >= MAX_FEATURED_ICONS) break;
    }

    const remainingSlots = Math.max(0, MAX_FEATURED_ICONS - validBuiltIn.length);

    for (const rawPath of nextCustom) {
      const normalizedPath = normalizeIconPath(rawPath);

      if (
        !normalizedPath ||
        !normalizedCustomProfileIconSet.has(normalizedPath) ||
        customSeen.has(normalizedPath)
      ) {
        continue;
      }

      customSeen.add(normalizedPath);
      validCustom.push(normalizedPath);

      if (validCustom.length >= remainingSlots) break;
    }

    setFeaturedIcons(validBuiltIn);
    setFeaturedCustomIcons(validCustom);

    try {
      const payload: PersistedFeaturedIcons = {
        builtIn: validBuiltIn,
        custom: validCustom,
      };

      window.localStorage.setItem(
        FEATURED_PROFILE_ICONS_KEY,
        JSON.stringify(payload)
      );
    } catch {
      // Ignore storage failures and keep in-memory state.
    }
  };

  const inlineVisibleIconItems = useMemo(() => {
    const validFeatured = featuredIcons.filter((icon) => availableIconSet.has(icon));
    const validFeaturedSet = new Set(validFeatured);
    const defaultIcons = INLINE_DEFAULT_ICONS.filter((icon) =>
      availableIconSet.has(icon)
    );
    const rest = defaultIcons.filter((icon) => !validFeaturedSet.has(icon));

    const featuredCustom = featuredCustomIcons.filter((iconPath) =>
      normalizedCustomProfileIconSet.has(iconPath)
    );

    const customCandidates =
      activeProfile.icon === "custom" && normalizedActiveCustomIconPath
        ? [
            normalizedActiveCustomIconPath,
            ...featuredCustom.filter(
              (path) => path !== normalizedActiveCustomIconPath
            ),
          ]
        : featuredCustom;

    const deduped = [
      ...validFeatured.map((icon) => ({
        type: "builtin" as const,
        value: icon,
      })),
      ...rest.map((icon) => ({
        type: "builtin" as const,
        value: icon,
      })),
      ...customCandidates.map((path) => ({
        type: "custom" as const,
        path,
      })),
    ].slice(0, inlineVisibleIconCount);

    if (
      activeProfile.icon === "custom" &&
      normalizedActiveCustomIconPath &&
      !deduped.some(
        (item) =>
          item.type === "custom" && item.path === normalizedActiveCustomIconPath
      )
    ) {
      if (deduped.length >= inlineVisibleIconCount) {
        deduped[deduped.length - 1] = {
          type: "custom",
          path: normalizedActiveCustomIconPath,
        };
      } else {
        deduped.push({
          type: "custom",
          path: normalizedActiveCustomIconPath,
        });
      }
    }

    return deduped;
  }, [
    activeProfile.icon,
    availableIconSet,
    featuredCustomIcons,
    featuredIcons,
    inlineVisibleIconCount,
    normalizedActiveCustomIconPath,
    normalizedCustomProfileIconSet,
  ]);

  useEffect(() => {
    const onResize = () => {
      setInlineVisibleIconCount(getInlineVisibleIconCount(window.innerWidth));
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FEATURED_PROFILE_ICONS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as PersistedFeaturedIcons | ExportProfileIcon[];

      const parsedBuiltIn = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray(parsed.builtIn)
          ? parsed.builtIn
          : [];

      const parsedCustom =
        !Array.isArray(parsed) &&
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.custom)
          ? parsed.custom
          : [];

      const builtInSeen = new Set<ExportProfileIcon>();
      const customSeen = new Set<string>();
      const validBuiltIn: ExportProfileIcon[] = [];
      const validCustom: string[] = [];

      for (const icon of parsedBuiltIn) {
        if (!availableIconSet.has(icon) || builtInSeen.has(icon)) continue;

        builtInSeen.add(icon);
        validBuiltIn.push(icon);

        if (validBuiltIn.length >= MAX_FEATURED_ICONS) break;
      }

      const remainingSlots = Math.max(0, MAX_FEATURED_ICONS - validBuiltIn.length);

      for (const iconPath of parsedCustom) {
        const normalizedPath = normalizeIconPath(iconPath);

        if (
          !normalizedPath ||
          !normalizedCustomProfileIconSet.has(normalizedPath) ||
          customSeen.has(normalizedPath)
        ) {
          continue;
        }

        customSeen.add(normalizedPath);
        validCustom.push(normalizedPath);

        if (validCustom.length >= remainingSlots) break;
      }

      setFeaturedIcons(validBuiltIn);
      setFeaturedCustomIcons(validCustom);
    } catch {
      // Ignore invalid persisted values.
    }
  }, [availableIconSet, normalizedCustomProfileIconSet]);

  useEffect(() => {
    if (!showIconPicker) return;

    const onMouseDown = (event: MouseEvent) => {
      if (!iconPickerRef.current?.contains(event.target as Node)) {
        setShowIconPicker(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowIconPicker(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showIconPicker]);

  const toggleFeaturedIcon = (icon: ExportProfileIcon) => {
    if (featuredIcons.includes(icon)) {
      saveFeaturedIcons(
        featuredIcons.filter((item) => item !== icon),
        featuredCustomIcons
      );
      return;
    }

    if (featuredIcons.length + featuredCustomIcons.length >= MAX_FEATURED_ICONS) {
      return;
    }

    saveFeaturedIcons([...featuredIcons, icon], featuredCustomIcons);
  };

  const toggleFeaturedCustomIcon = (iconPath: string) => {
    const normalizedPath = normalizeIconPath(iconPath);
    if (!normalizedPath) return;

    if (featuredCustomIcons.includes(normalizedPath)) {
      saveFeaturedIcons(
        featuredIcons,
        featuredCustomIcons.filter((item) => item !== normalizedPath)
      );
      return;
    }

    if (featuredIcons.length + featuredCustomIcons.length >= MAX_FEATURED_ICONS) {
      return;
    }

    saveFeaturedIcons(featuredIcons, [...featuredCustomIcons, normalizedPath]);
  };

  const handlePickCustomIcon = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Image",
          extensions: ICON_FILE_EXTENSIONS,
        },
      ],
    });

    if (!selected || typeof selected !== "string") return;

    setSourceIconPath(selected);
    setIconToCrop(convertFileSrc(selected));
    setShowIconPicker(false);
  };

  const handleDeleteCustomIcon = async (iconPath: string) => {
    const normalizedPath = normalizeIconPath(iconPath);

    try {
      await invoke("delete_profile_icon_file", { iconPath });
    } catch (error) {
      console.warn("Failed to delete custom profile icon file:", error);
    } finally {
      if (featuredCustomIcons.includes(normalizedPath)) {
        saveFeaturedIcons(
          featuredIcons,
          featuredCustomIcons.filter((item) => item !== normalizedPath)
        );
      }

      removeCustomProfileIcon(iconPath);
    }
  };

  const applyCustomIconSelection = (iconPath: string, closePicker: boolean) => {
    updateActiveProfile({
      icon: "custom",
      customIconPath: stampIconPath(iconPath),
    });

    if (closePicker) {
      setShowIconPicker(false);
    }
  };

  const handleCustomIconCropComplete = async (cropData: CropModalPayload) => {
    if (!sourceIconPath) return;

    try {
      const iconId = `${activeProfile.id}_${Date.now()}`;

      const storedPath = await invoke<string>("crop_and_save_profile_icon", {
        sourcePath: sourceIconPath,
        iconId,
        crop: {
          x: cropData.x,
          y: cropData.y,
          width: cropData.width,
          height: cropData.height,
          rotation: cropData.rotation,
          flip_h: cropData.flip.horizontal,
          flip_v: cropData.flip.vertical,
        },
      });

      const stampedPath = stampIconPath(storedPath);

      addCustomProfileIcon(stampedPath);

      updateActiveProfile({
        icon: "custom",
        customIconPath: stampedPath,
      });
    } catch (error) {
      console.error("Failed to crop and save profile icon:", error);
    } finally {
      setIconToCrop(null);
      setSourceIconPath(null);
    }
  };

  return (
    <>
      <div className="profile-icon-control-inline" ref={iconPickerRef}>
        <div className="profile-icon-inline-list">
          {inlineVisibleIconItems.map((item) => {
            if (item.type === "builtin") {
              return (
                <button
                  key={`builtin-${item.value}`}
                  type="button"
                  className={`profile-icon-button${
                    activeProfile.icon === item.value ? " active" : ""
                  }`}
                  title={item.value}
                  onClick={() => updateActiveProfile({ icon: item.value })}
                >
                  <ProfileIconGlyph
                    icon={item.value}
                    customIconPath={
                      item.value === "custom"
                        ? activeProfile.customIconPath
                        : null
                    }
                  />
                </button>
              );
            }

            const isActiveCustom =
              activeProfile.icon === "custom" &&
              normalizedActiveCustomIconPath === item.path;

            return (
              <div
                key={`custom-${item.path}`}
                className="profile-custom-icon-slot"
              >
                <button
                  type="button"
                  className={`profile-icon-button${isActiveCustom ? " active" : ""}`}
                  title="Use custom icon"
                  onClick={() => applyCustomIconSelection(item.path, false)}
                >
                  <img
                    className="profile-custom-icon"
                    src={convertFileSrc(item.path)}
                    alt="Custom profile icon"
                  />
                </button>

                <button
                  type="button"
                  className="profile-icon-delete"
                  title="Delete custom icon"
                  aria-label="Delete custom icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDeleteCustomIcon(item.path);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className={`profile-icon-button profile-upload-tile${
            activeProfile.icon === "custom" ? " active" : ""
          }`}
          title="Add custom icon"
          aria-label="Add custom icon"
          onClick={() => {
            void handlePickCustomIcon();
          }}
        >
          <FaPlus />
        </button>

        <button
          type="button"
          className="profile-icon-button profile-icon-more-trigger"
          title="Choose icon"
          aria-label="Choose icon"
          aria-expanded={showIconPicker}
          onClick={() => setShowIconPicker((current) => !current)}
        >
          <FaEllipsisH />
        </button>

        {showIconPicker && (
          <div
            className="profile-icon-popover"
            role="dialog"
            aria-label="Choose Profile Icon"
          >
            <div className="profile-icon-modal-header">
              <h3>Choose Profile Icon</h3>
            </div>

            <div className="profile-icon-grid">
              {pickerIconOptions.map((option) => {
                const pinned = featuredIcons.includes(option.value);

                return (
                  <div key={option.value} className="profile-icon-tile">
                    <button
                      type="button"
                      className={`profile-icon-button${
                        activeProfile.icon === option.value ? " active" : ""
                      }`}
                      title={option.label}
                      onClick={() => {
                        updateActiveProfile({ icon: option.value });
                        setShowIconPicker(false);
                      }}
                    >
                      <ProfileIconGlyph
                        icon={option.value}
                        customIconPath={null}
                      />
                    </button>

                    <button
                      type="button"
                      className={`profile-icon-pin${pinned ? " pinned" : ""}`}
                      title={
                        pinned
                          ? "Unpin from quick icons"
                          : "Pin to quick icons"
                      }
                      aria-label={
                        pinned
                          ? "Unpin from quick icons"
                          : "Pin to quick icons"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFeaturedIcon(option.value);
                      }}
                    >
                      <FaThumbtack />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="profile-icon-modal-header">
              <h3>Custom Icons</h3>
            </div>

            <div className="profile-icon-grid">
              <button
                type="button"
                className="profile-icon-button profile-upload-tile"
                title="Add custom icon"
                aria-label="Add custom icon"
                onClick={() => {
                  void handlePickCustomIcon();
                }}
              >
                <FaPlus />
              </button>

              {normalizedCustomProfileIcons.map((iconPath) => {
                const isActiveCustom =
                  activeProfile.icon === "custom" &&
                  normalizedActiveCustomIconPath === iconPath;

                const pinnedCustom = featuredCustomIcons.includes(iconPath);

                return (
                  <div
                    key={`popover-${iconPath}`}
                    className="profile-custom-icon-slot"
                  >
                    <button
                      type="button"
                      className={`profile-icon-button${
                        isActiveCustom ? " active" : ""
                      }`}
                      title="Use custom icon"
                      onClick={() => {
                        applyCustomIconSelection(iconPath, true);
                      }}
                    >
                      <img
                        className="profile-custom-icon"
                        src={convertFileSrc(iconPath)}
                        alt="Custom profile icon"
                      />
                    </button>

                    <button
                      type="button"
                      className={`profile-icon-pin profile-icon-pin-custom${
                        pinnedCustom ? " pinned" : ""
                      }`}
                      title={
                        pinnedCustom
                          ? "Unpin from quick icons"
                          : "Pin to quick icons"
                      }
                      aria-label={
                        pinnedCustom
                          ? "Unpin from quick icons"
                          : "Pin to quick icons"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFeaturedCustomIcon(iconPath);
                      }}
                    >
                      <FaThumbtack />
                    </button>

                    <button
                      type="button"
                      className="profile-icon-delete"
                      title="Delete custom icon"
                      aria-label="Delete custom icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteCustomIcon(iconPath);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {iconToCrop && (
        <CropModal
          image={iconToCrop}
          title="Crop Profile Icon"
          initialAspect={1}
          hint="Use a square crop for best icon quality"
          onClose={() => {
            setIconToCrop(null);
            setSourceIconPath(null);
          }}
          onCropComplete={(data) => {
            void handleCustomIconCropComplete(data);
          }}
        />
      )}
    </>
  );
}