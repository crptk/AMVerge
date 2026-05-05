import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FaFilm,
  FaInfoCircle,
  FaLayerGroup,
  FaMicrochip,
  FaPlus,
  FaRandom,
  FaRocket,
  FaTrash,
  FaVideo,
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

const PROFILE_ICON_COMPONENTS: Record<ExportProfileIcon, typeof FaVideo> = {
  video: FaVideo,
  remux: FaRandom,
  premiere: FaFilm,
  after_effects: FaLayerGroup,
  resolve: FaMicrochip,
  capcut: FaRocket,
};

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

  const activeProfile = useMemo(
    () => getActiveExportProfile(exportProfiles, activeExportProfileId),
    [exportProfiles, activeExportProfileId]
  );

  const profileOptions = useMemo(
    () =>
      exportProfiles.map((profile) => {
        const Icon = PROFILE_ICON_COMPONENTS[profile.icon];
        const summary = getExportProfileSummary(profile).replace(/ • /g, " / ");
        return {
          value: profile.id,
          label: profile.name.trim() || "Untitled Profile",
          description: summary,
          icon: <Icon />,
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
        const value = i + 1;
        return {
          value,
          label: `${value} Export${value > 1 ? "s" : ""}`,
        };
      }),
    [parallelLimit]
  );

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
    if (quickDownloadProfileId === resolvedQuickDownloadProfileId) return;
    setQuickDownloadProfileId(resolvedQuickDownloadProfileId);
  }, [quickDownloadProfileId, resolvedQuickDownloadProfileId, setQuickDownloadProfileId]);

  useEffect(() => {
    if (!gpuProbeComplete || !encodingWorkflow) return;

    const resolvedProfile: NvidiaEncoderProfile = nvidiaDetection.hasNvidiaGpu
      ? nvidiaDetection.profile
      : "unsupported";

    if (activeProfile.nvidiaEncoderProfile !== resolvedProfile) {
      updateExportProfile(activeProfile.id, {
        nvidiaEncoderProfile: resolvedProfile,
      });
    }
  }, [
    activeProfile.id,
    activeProfile.nvidiaEncoderProfile,
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
          <div className="profile-icon-grid">
            {EXPORT_PROFILE_ICON_OPTIONS.map((option) => {
              const Icon = PROFILE_ICON_COMPONENTS[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`profile-icon-button${activeProfile.icon === option.value ? " active" : ""}`}
                  title={option.label}
                  onClick={() => updateActiveProfile({ icon: option.value })}
                >
                  <Icon />
                </button>
              );
            })}
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
          description="Choose encoded audio, source audio copy, or no audio in exported video files."
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
                : `Detected limit: up to ${parallelLimit} parallel exports for this codec.`
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
          description="File format wrapper: MP4, MKV, MOV, AVI, or MXF."
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
