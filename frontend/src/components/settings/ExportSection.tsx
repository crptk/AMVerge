import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FaEllipsisH,
  FaInfoCircle,
  FaPlus,
  FaThumbtack,
  FaTrash,
} from "react-icons/fa";
import Dropdown from "../common/Dropdown";
import CropModal from "./CropModal";
import { useGeneralSettingsStore } from "../../stores/settingsStore";
import {
  EXPORT_AUDIO_OPTIONS,
  EXPORT_CODEC_FAMILY_OPTIONS,
  EXPORT_CONTAINER_OPTIONS,
  EXPORT_EDITOR_TARGET_OPTIONS,
  EXPORT_HARDWARE_OPTIONS,
  EXPORT_PROFILE_ICON_OPTIONS,
  EXPORT_WORKFLOW_OPTIONS,
  getActiveExportProfile,
  getCodecFamily,
  getCodecOptionsForFamily,
  getExportProfileSummary,
  isCodecNvencEligible,
  isCodecSupportedByNvidiaProfile,
  isQuickDownloadCompatibleWorkflow,
  isXmlTimelineWorkflow,
  getNvidiaEncoderProfile,
  getParallelExportLimit,
  getSafeDefaultParallelExports,
  normalizeExportProfile,
  supportsAudioMode,
  supportsClipMerge,
  supportsContainerSelection,
  usesEditorTarget,
  usesEncoding,
  NVIDIA_ENCODER_SUPPORT_MATRIX_URL,
  type ExportCodecFamily,
  type ExportProfile,
  type ExportProfileIcon,
  type ExportWorkflow,
  type NvidiaDetectionResult,
  type NvidiaEncoderProfile,
} from "../../features/export/profiles";
import { renderProfileIcon } from "../../features/export/profileIconUtils";

type ExportSettingProps = {
  label: string;
  description: ReactNode;
  control: ReactNode;
};

function ExportSetting({ label, description, control }: ExportSettingProps) {
  return (
    <div className="export-setting-block">
      <div className="settings-row export-setting-row">
        <label className="settings-label">{label}</label>
        <div className="settings-control export-setting-control">{control}</div>
      </div>
      <p className="export-setting-description">{description}</p>
    </div>
  );
}

const DEFAULT_DETECTION: NvidiaDetectionResult = {
  hasNvidiaGpu: false,
  gpuName: null,
  profile: "unsupported",
};
const FEATURED_PROFILE_ICONS_KEY = "amverge.featuredProfileIcons";
const INLINE_VISIBLE_ICON_COUNT = 8;
const MAX_FEATURED_ICONS = 8;
const INLINE_DEFAULT_ICONS: ExportProfileIcon[] = [
  "video",
  "remux",
  "premiere",
  "after_effects",
  "resolve",
  "capcut",
];
const ICON_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"];
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
  flip: { horizontal: boolean; vertical: boolean };
};

function normalizeIconPath(path: string | null | undefined): string {
  return (path || "").split("?")[0];
}

export default function ExportSection() {
  const exportProfiles = useGeneralSettingsStore((state) => state.exportProfiles);
  const activeExportProfileId = useGeneralSettingsStore((state) => state.activeExportProfileId);
  const quickDownloadProfileId = useGeneralSettingsStore((state) => state.quickDownloadProfileId);
  const setActiveExportProfileId = useGeneralSettingsStore((state) => state.setActiveExportProfileId);
  const setQuickDownloadProfileId = useGeneralSettingsStore((state) => state.setQuickDownloadProfileId);
  const addExportProfile = useGeneralSettingsStore((state) => state.addExportProfile);
  const deleteExportProfile = useGeneralSettingsStore((state) => state.deleteExportProfile);
  const updateExportProfile = useGeneralSettingsStore((state) => state.updateExportProfile);
  const customProfileIcons = useGeneralSettingsStore((state) => state.customProfileIcons);
  const addCustomProfileIcon = useGeneralSettingsStore((state) => state.addCustomProfileIcon);
  const removeCustomProfileIcon = useGeneralSettingsStore((state) => state.removeCustomProfileIcon);

  const [nvidiaDetection, setNvidiaDetection] = useState<NvidiaDetectionResult>(DEFAULT_DETECTION);
  const [gpuProbeComplete, setGpuProbeComplete] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [featuredIcons, setFeaturedIcons] = useState<ExportProfileIcon[]>([]);
  const [featuredCustomIcons, setFeaturedCustomIcons] = useState<string[]>([]);
  const [iconToCrop, setIconToCrop] = useState<string | null>(null);
  const [sourceIconPath, setSourceIconPath] = useState<string | null>(null);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);

  const activeProfile = useMemo(
    () => getActiveExportProfile(exportProfiles, activeExportProfileId),
    [exportProfiles, activeExportProfileId]
  );

  const profileOptions = useMemo(
    () =>
      exportProfiles.map((profile) => {
        const summary = getExportProfileSummary(profile).replace(/ • /g, " / ");
        return {
          value: profile.id,
          label: profile.name.trim() || "Untitled Profile",
          description: summary,
          icon: renderProfileIcon(profile),
        };
      }),
    [exportProfiles]
  );

  const quickDownloadCompatibleIds = useMemo(
    () =>
      new Set(
        exportProfiles
          .filter((profile) => isQuickDownloadCompatibleWorkflow(profile.workflow))
          .map((profile) => profile.id)
      ),
    [exportProfiles]
  );

  const quickDownloadProfileOptions = useMemo(
    () => profileOptions.filter((option) => quickDownloadCompatibleIds.has(option.value)),
    [profileOptions, quickDownloadCompatibleIds]
  );

  const resolvedQuickDownloadProfileId = useMemo(() => {
    if (quickDownloadProfileOptions.some((option) => option.value === quickDownloadProfileId)) {
      return quickDownloadProfileId;
    }
    if (quickDownloadProfileOptions.some((option) => option.value === activeProfile.id)) {
      return activeProfile.id;
    }
    return quickDownloadProfileOptions[0]?.value ?? activeProfile.id;
  }, [quickDownloadProfileId, quickDownloadProfileOptions, activeProfile.id]);

  const parallelLimit = getParallelExportLimit(activeProfile);
  const parallelLocked = parallelLimit <= 1;
  const effectiveParallelExports = Math.min(activeProfile.parallelExports, parallelLimit);
  const encodingWorkflow = usesEncoding(activeProfile.workflow);
  const editorWorkflow = usesEditorTarget(activeProfile.workflow);
  const xmlTimelineWorkflow = isXmlTimelineWorkflow(activeProfile.workflow);
  const showMergeSetting = supportsClipMerge(activeProfile.workflow);
  const showAudioSetting = supportsAudioMode(activeProfile.workflow);
  const showContainerSetting = supportsContainerSelection(activeProfile.workflow);
  const codecFamily = getCodecFamily(activeProfile.codec);
  const nvidiaProfile = getNvidiaEncoderProfile(activeProfile.nvidiaEncoderProfile);
  const codecNvencEligible = isCodecNvencEligible(activeProfile.codec);
  const nvidiaSupportsSelectedCodec = isCodecSupportedByNvidiaProfile(
    activeProfile.codec,
    activeProfile.nvidiaEncoderProfile
  );
  const gpuReadyForCodec = nvidiaDetection.hasNvidiaGpu && nvidiaSupportsSelectedCodec;
  const encoderLockedToCpu =
    encodingWorkflow && (!codecNvencEligible || (gpuProbeComplete && !gpuReadyForCodec));

  const codecProfileOptions = useMemo(() => getCodecOptionsForFamily(codecFamily), [codecFamily]);

  const parallelExportOptions = useMemo(
    () =>
      Array.from({ length: parallelLimit }, (_, i) => {
        const value = parallelLimit - i;
        return {
          value,
          label:
            value === parallelLimit && parallelLimit > 1
              ? `Maximum (${value} Exports)`
              : `${value} Export${value > 1 ? "s" : ""}`,
        };
      }),
    [parallelLimit]
  );
  const pickerIconOptions = useMemo(
    () => EXPORT_PROFILE_ICON_OPTIONS.filter((option) => option.value !== "custom"),
    []
  );
  const availableIconValues = useMemo(
    () => pickerIconOptions.map((option) => option.value),
    [pickerIconOptions]
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

  const saveFeaturedIcons = (nextBuiltIn: ExportProfileIcon[], nextCustom: string[]) => {
    const builtInSeen = new Set<ExportProfileIcon>();
    const customSeen = new Set<string>();
    const validBuiltIn: ExportProfileIcon[] = [];
    const validCustom: string[] = [];

    for (const icon of nextBuiltIn) {
      if (!availableIconValues.includes(icon) || builtInSeen.has(icon)) continue;
      builtInSeen.add(icon);
      validBuiltIn.push(icon);
      if (validBuiltIn.length >= MAX_FEATURED_ICONS) break;
    }

    const remainingSlots = Math.max(0, MAX_FEATURED_ICONS - validBuiltIn.length);
    for (const rawPath of nextCustom) {
      const normalizedPath = normalizeIconPath(rawPath);
      if (!normalizedPath || !normalizedCustomProfileIcons.includes(normalizedPath) || customSeen.has(normalizedPath)) {
        continue;
      }
      customSeen.add(normalizedPath);
      validCustom.push(normalizedPath);
      if (validCustom.length >= remainingSlots) break;
    }

    setFeaturedIcons(validBuiltIn);
    setFeaturedCustomIcons(validCustom);
    try {
      const payload: PersistedFeaturedIcons = { builtIn: validBuiltIn, custom: validCustom };
      window.localStorage.setItem(FEATURED_PROFILE_ICONS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures and keep in-memory state.
    }
  };

  const inlineVisibleIconItems = useMemo(() => {
    const validFeatured = featuredIcons.filter((icon) => availableIconValues.includes(icon));
    const defaultIcons = INLINE_DEFAULT_ICONS.filter((icon) => availableIconValues.includes(icon));
    const rest = defaultIcons.filter((icon) => !validFeatured.includes(icon));
    const featuredCustom = featuredCustomIcons.filter((iconPath) =>
      normalizedCustomProfileIcons.includes(iconPath)
    );
    const customCandidates =
      activeProfile.icon === "custom" && normalizedActiveCustomIconPath
        ? [normalizedActiveCustomIconPath, ...featuredCustom.filter((path) => path !== normalizedActiveCustomIconPath)]
        : featuredCustom;

    const deduped = [
      ...validFeatured.map((icon) => ({ type: "builtin" as const, value: icon })),
      ...rest.map((icon) => ({ type: "builtin" as const, value: icon })),
      ...customCandidates.map((path) => ({ type: "custom" as const, path })),
    ].slice(0, INLINE_VISIBLE_ICON_COUNT);

    if (
      activeProfile.icon === "custom" &&
      normalizedActiveCustomIconPath &&
      !deduped.some((item) => item.type === "custom" && item.path === normalizedActiveCustomIconPath)
    ) {
      if (deduped.length >= INLINE_VISIBLE_ICON_COUNT) {
        deduped[deduped.length - 1] = { type: "custom", path: normalizedActiveCustomIconPath };
      } else {
        deduped.push({ type: "custom", path: normalizedActiveCustomIconPath });
      }
    }

    return deduped;
  }, [
    activeProfile.icon,
    availableIconValues,
    featuredCustomIcons,
    featuredIcons,
    normalizedActiveCustomIconPath,
    normalizedCustomProfileIcons,
  ]);

  const toggleFeaturedIcon = (icon: ExportProfileIcon) => {
    if (featuredIcons.includes(icon)) {
      saveFeaturedIcons(
        featuredIcons.filter((item) => item !== icon),
        featuredCustomIcons
      );
      return;
    }
    if (featuredIcons.length + featuredCustomIcons.length >= MAX_FEATURED_ICONS) return;
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
    if (featuredIcons.length + featuredCustomIcons.length >= MAX_FEATURED_ICONS) return;
    saveFeaturedIcons(featuredIcons, [...featuredCustomIcons, normalizedPath]);
  };

  useEffect(() => {
    let canceled = false;

    invoke<NvidiaDetectionResult>("detect_nvidia_encoder_profile")
      .then((detected) => {
        if (canceled) return;
        setNvidiaDetection(detected);
      })
      .catch((error) => {
        console.error("Failed to detect NVIDIA encoder profile:", error);
      })
      .finally(() => {
        if (!canceled) setGpuProbeComplete(true);
      });

    return () => {
      canceled = true;
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
        if (!availableIconValues.includes(icon) || builtInSeen.has(icon)) continue;
        builtInSeen.add(icon);
        validBuiltIn.push(icon);
        if (validBuiltIn.length >= MAX_FEATURED_ICONS) break;
      }

      const remainingSlots = Math.max(0, MAX_FEATURED_ICONS - validBuiltIn.length);
      for (const iconPath of parsedCustom) {
        const normalizedPath = normalizeIconPath(iconPath);
        if (!normalizedPath || !normalizedCustomProfileIcons.includes(normalizedPath) || customSeen.has(normalizedPath)) {
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
  }, [availableIconValues, normalizedCustomProfileIcons]);

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

  useEffect(() => {
    if (quickDownloadProfileId === resolvedQuickDownloadProfileId) return;
    setQuickDownloadProfileId(resolvedQuickDownloadProfileId);
  }, [quickDownloadProfileId, resolvedQuickDownloadProfileId, setQuickDownloadProfileId]);

  useEffect(() => {
    if (!gpuProbeComplete || !encodingWorkflow) return;

    const resolvedProfile: NvidiaEncoderProfile = nvidiaDetection.hasNvidiaGpu
      ? nvidiaDetection.profile
      : "unsupported";

    if (activeProfile.nvidiaEncoderProfile !== resolvedProfile) {
      const nextProfile = normalizeExportProfile({
        ...activeProfile,
        nvidiaEncoderProfile: resolvedProfile,
      });
      const nextLimit = getParallelExportLimit(nextProfile);
      const shouldApplySafeDefault =
        activeProfile.parallelExports <= 1 &&
        activeProfile.nvidiaEncoderProfile === "unknown" &&
        nextLimit > 1;

      updateExportProfile(activeProfile.id, {
        nvidiaEncoderProfile: resolvedProfile,
        parallelExports: shouldApplySafeDefault
          ? getSafeDefaultParallelExports(nextLimit)
          : activeProfile.parallelExports,
      });
    }
  }, [
    activeProfile,
    activeProfile.id,
    activeProfile.nvidiaEncoderProfile,
    activeProfile.parallelExports,
    encodingWorkflow,
    gpuProbeComplete,
    nvidiaDetection.hasNvidiaGpu,
    nvidiaDetection.profile,
    updateExportProfile,
  ]);

  useEffect(() => {
    if (!encoderLockedToCpu) return;
    if (activeProfile.hardwareMode === "cpu") return;
    updateExportProfile(activeProfile.id, { hardwareMode: "cpu" });
  }, [activeProfile.hardwareMode, activeProfile.id, encoderLockedToCpu, updateExportProfile]);

  useEffect(() => {
    const normalized = normalizeExportProfile(activeProfile);
    if (
      normalized.parallelExports !== activeProfile.parallelExports ||
      normalized.hardwareMode !== activeProfile.hardwareMode ||
      normalized.editorTarget !== activeProfile.editorTarget ||
      normalized.codec !== activeProfile.codec ||
      normalized.nvidiaEncoderProfile !== activeProfile.nvidiaEncoderProfile
    ) {
      updateExportProfile(activeProfile.id, {
        parallelExports: normalized.parallelExports,
        hardwareMode: normalized.hardwareMode,
        editorTarget: normalized.editorTarget,
        codec: normalized.codec,
        nvidiaEncoderProfile: normalized.nvidiaEncoderProfile,
      });
    }
  }, [activeProfile, updateExportProfile]);

  const updateActiveProfile = (changes: Partial<ExportProfile>) => {
    updateExportProfile(activeProfile.id, changes);
  };

  const handleWorkflowChange = (workflow: ExportWorkflow) => {
    updateActiveProfile({
      workflow,
      editorTarget: usesEditorTarget(workflow)
        ? activeProfile.editorTarget === "none"
          ? "premiere_pro"
          : activeProfile.editorTarget
        : "none",
      hardwareMode: usesEncoding(workflow) ? activeProfile.hardwareMode : "cpu",
      parallelExports: usesEncoding(workflow) ? activeProfile.parallelExports : 1,
    });
  };

  const handleCodecFamilyChange = (family: ExportCodecFamily) => {
    const options = getCodecOptionsForFamily(family);
    updateActiveProfile({ codec: options[0]?.value ?? activeProfile.codec });
  };

  const handlePickCustomIcon = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ICON_FILE_EXTENSIONS }],
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

      const normalizedStoredPath = storedPath.split("?")[0];
      const stampedPath = `${normalizedStoredPath}?t=${Date.now()}`;

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
    <section className="panel export-settings-panel">
      <h3>Export</h3>

      <ExportSetting
        label="Active Profile"
        description="Export Now uses this active profile (including newly created profiles)."
        control={
          <Dropdown
            className="settings-wide-dropdown export-profile-dropdown"
            options={profileOptions}
            value={activeProfile.id}
            onChange={setActiveExportProfileId}
          />
        }
      />

      <div className="export-profile-actions-row">
        <button type="button" className="buttons export-profile-action" onClick={addExportProfile}>
          <FaPlus />
          <span>New Profile</span>
        </button>
        <button
          type="button"
          className="buttons export-profile-action danger"
          onClick={() => deleteExportProfile(activeProfile.id)}
          disabled={exportProfiles.length <= 1}
        >
          <FaTrash />
          <span>Delete Profile</span>
        </button>
      </div>

      <ExportSetting
        label="Quick Download Profile"
        description={
          quickDownloadProfileOptions.length > 0
            ? "Used by clip quick download buttons. XML timeline profiles are hidden because they do not export media files."
            : "Used by clip quick download buttons."
        }
        control={
          <Dropdown
            className="settings-wide-dropdown export-profile-dropdown"
            options={quickDownloadProfileOptions.length > 0 ? quickDownloadProfileOptions : profileOptions}
            value={resolvedQuickDownloadProfileId}
            onChange={setQuickDownloadProfileId}
          />
        }
      />

      <ExportSetting
        label="Profile Name"
        description="Display name shown in the export profile selector."
        control={
          <input
            id="export-profile-name"
            className="settings-text-input"
            value={activeProfile.name}
            onChange={(event) => updateActiveProfile({ name: event.target.value })}
          />
        }
      />

      <ExportSetting
        label="Profile Icon"
        description="Visual icon used in the profile selector."
        control={
          <div className="profile-icon-control-inline" ref={iconPickerRef}>
            <div className="profile-icon-inline-list">
              {inlineVisibleIconItems.map((item) => {
                if (item.type === "builtin") {
                  return (
                    <button
                      key={`builtin-${item.value}`}
                      type="button"
                      className={`profile-icon-button${activeProfile.icon === item.value ? " active" : ""}`}
                      title={item.value}
                      onClick={() => updateActiveProfile({ icon: item.value })}
                    >
                      {renderProfileIcon({
                        icon: item.value,
                        customIconPath: item.value === "custom" ? activeProfile.customIconPath : null,
                      })}
                    </button>
                  );
                }

                const isActiveCustom =
                  activeProfile.icon === "custom" && normalizedActiveCustomIconPath === item.path;
                return (
                  <div key={`custom-${item.path}`} className="profile-custom-icon-slot">
                    <button
                      type="button"
                      className={`profile-icon-button${isActiveCustom ? " active" : ""}`}
                      title="Use custom icon"
                      onClick={() =>
                        updateActiveProfile({
                          icon: "custom",
                          customIconPath: `${item.path}?t=${Date.now()}`,
                        })
                      }
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
              className={`profile-icon-button profile-upload-tile${activeProfile.icon === "custom" ? " active" : ""}`}
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
              <div className="profile-icon-popover" role="dialog" aria-label="Choose Profile Icon">
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
                          className={`profile-icon-button${activeProfile.icon === option.value ? " active" : ""}`}
                          title={option.label}
                          onClick={() => {
                            updateActiveProfile({ icon: option.value });
                            setShowIconPicker(false);
                          }}
                        >
                          {renderProfileIcon({ icon: option.value, customIconPath: null })}
                        </button>
                        <button
                          type="button"
                          className={`profile-icon-pin${pinned ? " pinned" : ""}`}
                          title={pinned ? "Unpin from quick icons" : "Pin to quick icons"}
                          aria-label={pinned ? "Unpin from quick icons" : "Pin to quick icons"}
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
                      activeProfile.icon === "custom" && normalizedActiveCustomIconPath === iconPath;
                    const pinnedCustom = featuredCustomIcons.includes(iconPath);
                    return (
                      <div key={`popover-${iconPath}`} className="profile-custom-icon-slot">
                        <button
                          type="button"
                          className={`profile-icon-button${isActiveCustom ? " active" : ""}`}
                          title="Use custom icon"
                          onClick={() => {
                            updateActiveProfile({
                              icon: "custom",
                              customIconPath: `${iconPath}?t=${Date.now()}`,
                            });
                            setShowIconPicker(false);
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
                          className={`profile-icon-pin profile-icon-pin-custom${pinnedCustom ? " pinned" : ""}`}
                          title={pinnedCustom ? "Unpin from quick icons" : "Pin to quick icons"}
                          aria-label={pinnedCustom ? "Unpin from quick icons" : "Pin to quick icons"}
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
        }
      />

      <ExportSetting
        label="Workflow"
        description="Select export behavior: files, files + editor import, XML timeline, or direct send."
        control={
          <Dropdown
            className="settings-wide-dropdown"
            options={EXPORT_WORKFLOW_OPTIONS}
            value={activeProfile.workflow}
            onChange={handleWorkflowChange}
          />
        }
      />

      {xmlTimelineWorkflow && (
        <div className="export-profile-note">
          <FaInfoCircle />
          <span>
            XML source workflow only uses timeline + editor target. Encode/file parameters are hidden because they do not
            affect this export mode.
          </span>
        </div>
      )}

      {showMergeSetting && (
        <ExportSetting
          label="Merge Clips"
          description="When enabled, selected clips are merged into a single output file."
          control={
            <label className="custom-checkbox">
              <input
                type="checkbox"
                className="checkbox"
                checked={activeProfile.mergeEnabled}
                onChange={(event) => updateActiveProfile({ mergeEnabled: event.target.checked })}
              />
              <span className="checkmark"></span>
            </label>
          }
        />
      )}

      {editorWorkflow && (
        <ExportSetting
          label="Editor Target"
          description="Choose target editor integration profile."
          control={
            <Dropdown
              className="settings-wide-dropdown"
              options={EXPORT_EDITOR_TARGET_OPTIONS}
              value={activeProfile.editorTarget}
              onChange={(editorTarget) => updateActiveProfile({ editorTarget })}
            />
          }
        />
      )}

      {encodingWorkflow && (
        <>
          <ExportSetting
            label="Codec"
            description="Video codec family used when exporting files."
            control={
              <Dropdown
                className="settings-wide-dropdown"
                options={EXPORT_CODEC_FAMILY_OPTIONS}
                value={codecFamily}
                onChange={handleCodecFamilyChange}
              />
            }
          />

          <ExportSetting
            label="Codec Profile"
            description="Quality/compression profile for the selected codec."
            control={
              <Dropdown
                className="settings-wide-dropdown"
                options={codecProfileOptions}
                value={activeProfile.codec}
                onChange={(codec) => updateActiveProfile({ codec })}
              />
            }
          />
        </>
      )}

      {showAudioSetting && (
        <ExportSetting
          label="Audio Codec"
          description="Choose encoded audio, source audio copy, or no audio. Audio copy keeps original codec/channels/layout exactly."
          control={
            <Dropdown
              className="settings-wide-dropdown"
              options={EXPORT_AUDIO_OPTIONS}
              value={activeProfile.audioMode}
              onChange={(audioMode) => updateActiveProfile({ audioMode })}
            />
          }
        />
      )}

      {encodingWorkflow && (
        <>
          <ExportSetting
            label="Video Encoder"
            description={
              encoderLockedToCpu ? (
                codecNvencEligible ? (
                  "CPU only for this profile/codec on current machine."
                ) : (
                  "Selected codec is CPU-only (no NVENC path)."
                )
              ) : (
                <>
                  {nvidiaDetection.hasNvidiaGpu
                    ? `Auto NVIDIA profile: ${nvidiaProfile.label}${nvidiaDetection.gpuName ? ` (${nvidiaDetection.gpuName})` : ""}.`
                    : "No NVIDIA GPU detected. Auto mode falls back to CPU."}{" "}
                  <a href={NVIDIA_ENCODER_SUPPORT_MATRIX_URL} target="_blank" rel="noreferrer">
                    NVIDIA matrix
                  </a>
                </>
              )
            }
            control={
              <Dropdown
                className="settings-wide-dropdown"
                options={EXPORT_HARDWARE_OPTIONS}
                value={encoderLockedToCpu ? "cpu" : activeProfile.hardwareMode}
                onChange={(hardwareMode) => updateActiveProfile({ hardwareMode })}
                disabled={encoderLockedToCpu}
              />
            }
          />

          <ExportSetting
            label="Parallel Encodes"
            description={
              parallelLocked
                ? "Enabled only when NVIDIA profile and codec support parallel NVENC sessions."
                : `Detected limit: up to ${parallelLimit} parallel exports for this codec. Default is ${getSafeDefaultParallelExports(parallelLimit)} for stability.`
            }
            control={
              <Dropdown
                className="settings-wide-dropdown"
                options={parallelExportOptions}
                value={effectiveParallelExports}
                onChange={(parallelExports) => updateActiveProfile({ parallelExports })}
                disabled={parallelLocked}
              />
            }
          />
        </>
      )}

      {showContainerSetting && (
        <ExportSetting
          label="Container"
          description="File format wrapper: MP4, MKV, or MOV."
          control={
            <Dropdown
              className="settings-wide-dropdown"
              options={EXPORT_CONTAINER_OPTIONS}
              value={activeProfile.container}
              onChange={(container) => updateActiveProfile({ container })}
            />
          }
        />
      )}

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
    </section>
  );
}
