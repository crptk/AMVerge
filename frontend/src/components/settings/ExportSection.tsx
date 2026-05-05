import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FaEllipsisH,
  FaInfoCircle,
  FaPlus,
  FaThumbtack,
  FaTrash,
} from "react-icons/fa";
import Dropdown from "../common/Dropdown";
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

export default function ExportSection() {
  const exportProfiles = useGeneralSettingsStore((state) => state.exportProfiles);
  const activeExportProfileId = useGeneralSettingsStore((state) => state.activeExportProfileId);
  const quickDownloadProfileId = useGeneralSettingsStore((state) => state.quickDownloadProfileId);
  const setActiveExportProfileId = useGeneralSettingsStore((state) => state.setActiveExportProfileId);
  const setQuickDownloadProfileId = useGeneralSettingsStore((state) => state.setQuickDownloadProfileId);
  const addExportProfile = useGeneralSettingsStore((state) => state.addExportProfile);
  const deleteExportProfile = useGeneralSettingsStore((state) => state.deleteExportProfile);
  const updateExportProfile = useGeneralSettingsStore((state) => state.updateExportProfile);

  const [nvidiaDetection, setNvidiaDetection] = useState<NvidiaDetectionResult>(DEFAULT_DETECTION);
  const [gpuProbeComplete, setGpuProbeComplete] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [featuredIcons, setFeaturedIcons] = useState<ExportProfileIcon[]>([]);
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
  const availableIconValues = useMemo(
    () => EXPORT_PROFILE_ICON_OPTIONS.map((option) => option.value),
    []
  );
  const inlineVisibleIcons = useMemo(() => {
    const validFeatured = featuredIcons.filter((icon) => availableIconValues.includes(icon));
    const defaultIcons = INLINE_DEFAULT_ICONS.filter((icon) => availableIconValues.includes(icon));
    const rest = defaultIcons.filter((icon) => !validFeatured.includes(icon));
    return [...validFeatured, ...rest].slice(0, INLINE_VISIBLE_ICON_COUNT);
  }, [availableIconValues, featuredIcons]);

  const saveFeaturedIcons = (nextIcons: ExportProfileIcon[]) => {
    setFeaturedIcons(nextIcons);
    try {
      window.localStorage.setItem(FEATURED_PROFILE_ICONS_KEY, JSON.stringify(nextIcons));
    } catch {
      // Ignore storage failures and keep in-memory state.
    }
  };

  const toggleFeaturedIcon = (icon: ExportProfileIcon) => {
    if (featuredIcons.includes(icon)) {
      saveFeaturedIcons(featuredIcons.filter((item) => item !== icon));
      return;
    }
    if (featuredIcons.length >= MAX_FEATURED_ICONS) return;
    saveFeaturedIcons([...featuredIcons, icon]);
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
      const parsed = JSON.parse(raw) as ExportProfileIcon[];
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((icon) => availableIconValues.includes(icon)).slice(0, MAX_FEATURED_ICONS);
      setFeaturedIcons(valid);
    } catch {
      // Ignore invalid persisted values.
    }
  }, [availableIconValues]);

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
              {inlineVisibleIcons.map((iconValue) => {
                return (
                  <button
                    key={iconValue}
                    type="button"
                    className={`profile-icon-button${activeProfile.icon === iconValue ? " active" : ""}`}
                    title={iconValue}
                    onClick={() => updateActiveProfile({ icon: iconValue })}
                  >
                    {renderProfileIcon({
                      icon: iconValue,
                      customIconPath: iconValue === "custom" ? activeProfile.customIconPath : null,
                    })}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`profile-icon-button profile-upload-tile${activeProfile.icon === "custom" ? " active" : ""}`}
              title="Use custom icon slot"
              aria-label="Use custom icon slot"
              onClick={() => updateActiveProfile({ icon: "custom" })}
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
                  {EXPORT_PROFILE_ICON_OPTIONS.map((option) => {
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
                          {renderProfileIcon({
                            icon: option.value,
                            customIconPath: option.value === "custom" ? activeProfile.customIconPath : null,
                          })}
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
    </section>
  );
}
