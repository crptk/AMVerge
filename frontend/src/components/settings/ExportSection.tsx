import { useEffect, useMemo, type ReactNode } from "react";
import {
  FaBolt,
  FaFilm,
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
  getParallelExportLimit,
  NVIDIA_ENCODER_PROFILE_OPTIONS,
  normalizeExportProfile,
  usesEditorTarget,
  usesEncoding,
  type ExportCodecFamily,
  type ExportProfile,
  type ExportProfileIcon,
  type ExportWorkflow,
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

export default function ExportSection() {
  const exportProfiles = useGeneralSettingsStore((state) => state.exportProfiles);
  const activeExportProfileId = useGeneralSettingsStore((state) => state.activeExportProfileId);
  const setActiveExportProfileId = useGeneralSettingsStore((state) => state.setActiveExportProfileId);
  const quickDownloadProfileId = useGeneralSettingsStore(
    (state) => state.quickDownloadProfileId || state.activeExportProfileId
  );
  const setQuickDownloadProfileId = useGeneralSettingsStore((state) => state.setQuickDownloadProfileId);
  const addExportProfile = useGeneralSettingsStore((state) => state.addExportProfile);
  const deleteExportProfile = useGeneralSettingsStore((state) => state.deleteExportProfile);
  const updateExportProfile = useGeneralSettingsStore((state) => state.updateExportProfile);

  const activeProfile = useMemo(
    () => getActiveExportProfile(exportProfiles, activeExportProfileId),
    [exportProfiles, activeExportProfileId]
  );

  const profileOptions = useMemo(
    () =>
      exportProfiles.map((profile) => {
        const Icon = PROFILE_ICON_COMPONENTS[profile.icon];
        return {
          value: profile.id,
          label: profile.name.trim() || "Untitled Profile",
          description: `${getExportProfileSummary(profile)} • ${profile.mergeEnabled ? "MERGE" : "CLIPS"}`,
          icon: <Icon />,
        };
      }),
    [exportProfiles]
  );

  const parallelLimit = getParallelExportLimit(activeProfile);
  const parallelLocked = parallelLimit <= 1;
  const effectiveParallelExports = Math.min(activeProfile.parallelExports, parallelLimit);
  const encodingWorkflow = usesEncoding(activeProfile.workflow);
  const editorWorkflow = usesEditorTarget(activeProfile.workflow);
  const codecFamily = getCodecFamily(activeProfile.codec);

  const codecProfileOptions = useMemo(
    () => getCodecOptionsForFamily(codecFamily),
    [codecFamily]
  );

  const parallelExportOptions = useMemo(
    () =>
      Array.from({ length: parallelLimit }, (_, i) => {
        const value = i + 1;
        return {
          value,
          label: `${value} Encode${value > 1 ? "s" : ""}`,
        };
      }),
    [parallelLimit]
  );

  useEffect(() => {
    const normalized = normalizeExportProfile(activeProfile);
    if (
      normalized.parallelExports !== activeProfile.parallelExports ||
      normalized.hardwareMode !== activeProfile.hardwareMode ||
      normalized.editorTarget !== activeProfile.editorTarget
    ) {
      updateExportProfile(activeProfile.id, {
        parallelExports: normalized.parallelExports,
        hardwareMode: normalized.hardwareMode,
        editorTarget: normalized.editorTarget,
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
            className="settings-wide-dropdown export-profile-selector-dropdown"
            options={profileOptions}
            value={activeProfile.id}
            onChange={setActiveExportProfileId}
          />
        }
      />

      <ExportSetting
        label="Quick Download Profile"
        description="Clip download buttons use this video profile instead of the active export profile."
        control={
          <Dropdown
            className="settings-wide-dropdown export-profile-selector-dropdown"
            options={profileOptions}
            value={quickDownloadProfileId}
            onChange={setQuickDownloadProfileId}
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
          <span>Delete Active</span>
        </button>
      </div>

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

      <ExportSetting
        label="Video Encoder"
        description="H.264/H.265 use NVIDIA NVENC automatically when FFmpeg and GPU support it."
        control={
          <Dropdown
            className="settings-wide-dropdown"
            options={EXPORT_HARDWARE_OPTIONS}
            value={activeProfile.hardwareMode}
            onChange={(hardwareMode) => updateActiveProfile({ hardwareMode })}
            disabled={!encodingWorkflow}
          />
        }
      />

      <ExportSetting
        label="Parallel Encodes"
        description={
          parallelLocked
            ? "Enabled only when codec and encoder mode can use GPU (NVENC available)."
            : `GPU supports up to ${parallelLimit} parallel encodes for this configuration.`
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

      {encodingWorkflow && (
        <ExportSetting
          label="NVIDIA Encoder Profile"
          description="Match your GPU generation to unlock valid codecs and parallel export limits."
          control={
            <Dropdown
              className="settings-wide-dropdown"
              options={NVIDIA_ENCODER_PROFILE_OPTIONS}
              value={activeProfile.nvidiaEncoderProfile}
              onChange={(nvidiaEncoderProfile) => updateActiveProfile({ nvidiaEncoderProfile })}
              disabled={activeProfile.hardwareMode === "cpu"}
            />
          }
        />
      )}

      <div className="export-profile-note">
        <FaBolt />
        <span>Parallel GPU export follows NVIDIA NVENC generation and codec support matrix limits.</span>
      </div>
    </section>
  );
}
