import { useEffect, useMemo } from "react";
import Dropdown from "../../common/Dropdown";
import SettingRow from "../../common/SettingRow";
import { useGeneralSettingsStore } from "../../../stores/settingsStore";
import {
  EXPORT_CONTAINER_OPTIONS,
  EXPORT_WORKFLOW_OPTIONS,
  getActiveExportProfile,
  getCodecFamily,
  getExportProfileSummary,
  getParallelExportLimit,
  isCodecGpuEligible,
  normalizeExportProfile,
  supportsAudioMode,
  supportsClipMerge,
  supportsContainerSelection,
  usesEncoding,
  type ExportProfile,
  type ExportWorkflow,
  type GpuEncoderCapabilities,
  type NvidiaEncoderProfile,
} from "../../../features/export/profiles";
import { renderProfileIcon } from "../../../features/export/profileIconUtils";
import useGpuEncoderDetection from "./hooks/useGpuEncoderDetection";
import ProfileActions from "./ProfileActions";
import ProfileIconPicker from "./ProfileIconPicker";
import ExportCodecSettings from "./ExportCodecSettings";
import ExportHardwareSettings from "./ExportHardwareSettings";

function resolveGpuEncoderForCodec(
  codec: ExportProfile["codec"],
  capabilities: GpuEncoderCapabilities
): string | null {
  if (codec === "av1_main" || codec === "av1") return capabilities.av1Encoder;

  const family = getCodecFamily(codec);

  if (family === "h264") return capabilities.h264Encoder;
  if (family === "h265") return capabilities.h265Encoder;

  return null;
}

export default function ExportSection() {
  const exportProfiles = useGeneralSettingsStore((state) => state.exportProfiles);
  const activeExportProfileId = useGeneralSettingsStore((state) => state.activeExportProfileId);
  const setActiveExportProfileId = useGeneralSettingsStore((state) => state.setActiveExportProfileId);
  const addExportProfile = useGeneralSettingsStore((state) => state.addExportProfile);
  const deleteExportProfile = useGeneralSettingsStore((state) => state.deleteExportProfile);
  const updateExportProfile = useGeneralSettingsStore((state) => state.updateExportProfile);
  const customProfileIcons = useGeneralSettingsStore((state) => state.customProfileIcons);
  const addCustomProfileIcon = useGeneralSettingsStore((state) => state.addCustomProfileIcon);
  const removeCustomProfileIcon = useGeneralSettingsStore((state) => state.removeCustomProfileIcon);
  const openFileLocationAfterExport = useGeneralSettingsStore(
    (state) => state.openFileLocationAfterExport
  );
  const setOpenFileLocationAfterExport = useGeneralSettingsStore(
    (state) => state.setOpenFileLocationAfterExport
  );

  const {
    nvidiaDetection,
    gpuCapabilities,
    gpuProbeComplete,
  } = useGpuEncoderDetection();

  const activeProfile = useMemo(
    () => getActiveExportProfile(exportProfiles, activeExportProfileId),
    [exportProfiles, activeExportProfileId]
  );

  const profileOptions = useMemo(
    () =>
      exportProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name.trim() || "Untitled Profile",
        description: getExportProfileSummary(profile).replace(/ • /g, " / "),
        icon: renderProfileIcon(profile),
      })),
    [exportProfiles]
  );

  const encodingWorkflow = usesEncoding(activeProfile.workflow);
  const showMergeSetting = supportsClipMerge(activeProfile.workflow);
  const showAudioSetting = supportsAudioMode(activeProfile.workflow);
  const showContainerSetting = supportsContainerSelection(activeProfile.workflow);

  const codecGpuEligible = isCodecGpuEligible(activeProfile.codec);
  const selectedGpuEncoder = resolveGpuEncoderForCodec(activeProfile.codec, gpuCapabilities);
  const gpuReadyForCodec = Boolean(selectedGpuEncoder);
  const encoderLockedToCpu = encodingWorkflow && !codecGpuEligible;

  const nvidiaParallelLimit = getParallelExportLimit(activeProfile);
  const parallelLimit =
    !encodingWorkflow || activeProfile.hardwareMode === "cpu"
      ? 1
      : !codecGpuEligible || !gpuReadyForCodec
        ? 1
        : gpuCapabilities.preferredBackend === "nvidia"
          ? nvidiaParallelLimit
          : 1;

  const parallelLocked = parallelLimit <= 1;
  const effectiveParallelExports = Math.min(activeProfile.parallelExports, parallelLimit);

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

  // Sync the persisted nvidiaEncoderProfile to whatever the GPU probe detected,
  // and clamp parallelExports into the valid [1, nextParallelLimit] range when
  // the limit shrinks (e.g. user switched codec/profile). Does NOT auto-bump
  // the user's chosen value upward — the user's choice of "1 parallel" is
  // always respected.
  useEffect(() => {
    if (!gpuProbeComplete || !encodingWorkflow) return;

    const resolvedProfile: NvidiaEncoderProfile = nvidiaDetection.hasNvidiaGpu
      ? nvidiaDetection.profile
      : "unsupported";

    const detectedEncoderForCodec = resolveGpuEncoderForCodec(activeProfile.codec, gpuCapabilities);

    const nextParallelLimit =
      resolvedProfile !== "unsupported" &&
      gpuCapabilities.preferredBackend === "nvidia" &&
      Boolean(detectedEncoderForCodec) &&
      codecGpuEligible
        ? getParallelExportLimit({
            ...activeProfile,
            nvidiaEncoderProfile: resolvedProfile,
          })
        : 1;

    const clampedParallelExports = Math.max(
      1,
      Math.min(activeProfile.parallelExports, nextParallelLimit)
    );

    if (
      activeProfile.nvidiaEncoderProfile !== resolvedProfile ||
      clampedParallelExports !== activeProfile.parallelExports
    ) {
      updateExportProfile(activeProfile.id, {
        nvidiaEncoderProfile: resolvedProfile,
        parallelExports: clampedParallelExports,
      });
    }
  }, [
    activeProfile,
    activeProfile.id,
    activeProfile.nvidiaEncoderProfile,
    activeProfile.parallelExports,
    activeProfile.codec,
    codecGpuEligible,
    encodingWorkflow,
    gpuProbeComplete,
    gpuCapabilities,
    gpuCapabilities.preferredBackend,
    nvidiaDetection.hasNvidiaGpu,
    nvidiaDetection.profile,
    updateExportProfile,
  ]);

  // Codecs that have no GPU encoder path (ProRes, DNxHR, etc.) must be CPU.
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
      hardwareMode: usesEncoding(workflow) ? activeProfile.hardwareMode : "cpu",
      parallelExports: usesEncoding(workflow) ? activeProfile.parallelExports : 1,
    });
  };

  return (
    <section className="panel menu-panel settings-panel export-settings-panel">
      <h3>Export</h3>

      <div className="about-content">
        <SettingRow
          label="Active Profile"
          description="Export Now uses this active profile, including newly created profiles."
          control={
            <Dropdown
              className="settings-wide-dropdown export-profile-dropdown"
              options={profileOptions}
              value={activeProfile.id}
              onChange={setActiveExportProfileId}
            />
          }
        />

        <ProfileActions
          canDelete={exportProfiles.length > 1}
          onAddProfile={addExportProfile}
          onDeleteProfile={() => deleteExportProfile(activeProfile.id)}
        />

        <SettingRow
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

        <SettingRow
          label="Profile Icon"
          description="Visual icon used in the profile selector."
          control={
            <ProfileIconPicker
              activeProfile={activeProfile}
              customProfileIcons={customProfileIcons}
              addCustomProfileIcon={addCustomProfileIcon}
              removeCustomProfileIcon={removeCustomProfileIcon}
              updateActiveProfile={updateActiveProfile}
            />
          }
        />

        <SettingRow
          label="Workflow"
          description="Select export behavior: re-encode video or stream-copy remux."
          control={
            <Dropdown
              className="settings-wide-dropdown"
              options={EXPORT_WORKFLOW_OPTIONS}
              value={activeProfile.workflow}
              onChange={handleWorkflowChange}
            />
          }
        />

        <SettingRow
          label="Open file location after export"
          description="Automatically open File Explorer and highlight the exported file after export finishes."
          control={
            <label className="custom-checkbox" aria-label="Toggle opening exported file location">
              <input
                type="checkbox"
                className="checkbox"
                checked={openFileLocationAfterExport}
                onChange={(event) => setOpenFileLocationAfterExport(event.target.checked)}
              />
              <span className="checkmark" />
            </label>
          }
        />

        {showMergeSetting && (
          <SettingRow
            label="Merge Clips"
            description="When enabled, selected clips are merged into a single output file."
            control={
              <label className="custom-checkbox" aria-label="Merge clips">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={activeProfile.mergeEnabled}
                  onChange={(event) => updateActiveProfile({ mergeEnabled: event.target.checked })}
                />
                <span className="checkmark" />
              </label>
            }
          />
        )}

        {(encodingWorkflow || showAudioSetting) && (
          <ExportCodecSettings
            activeProfile={activeProfile}
            showCodecSettings={encodingWorkflow}
            showAudioSetting={showAudioSetting}
            updateActiveProfile={updateActiveProfile}
          />
        )}

        {encodingWorkflow && (
          <ExportHardwareSettings
            activeProfile={activeProfile}
            nvidiaDetection={nvidiaDetection}
            gpuCapabilities={gpuCapabilities}
            gpuProbeComplete={gpuProbeComplete}
            selectedGpuEncoder={selectedGpuEncoder}
            gpuReadyForCodec={gpuReadyForCodec}
            encoderLockedToCpu={encoderLockedToCpu}
            parallelLocked={parallelLocked}
            parallelLimit={parallelLimit}
            effectiveParallelExports={effectiveParallelExports}
            parallelExportOptions={parallelExportOptions}
            updateActiveProfile={updateActiveProfile}
          />
        )}

        {showContainerSetting && (
          <SettingRow
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
      </div>
    </section>
  );
}