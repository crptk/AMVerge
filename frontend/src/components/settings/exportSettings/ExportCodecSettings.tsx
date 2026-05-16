import Dropdown from "../../common/Dropdown";
import SettingRow from "../../common/SettingRow";
import {
  EXPORT_AUDIO_OPTIONS,
  EXPORT_CODEC_FAMILY_OPTIONS,
  getCodecFamily,
  getCodecOptionsForFamily,
  type ExportCodecFamily,
  type ExportProfile,
} from "../../../features/export/profiles";

type ExportCodecSettingsProps = {
  activeProfile: ExportProfile;
  showCodecSettings: boolean;
  showAudioSetting: boolean;
  updateActiveProfile: (changes: Partial<ExportProfile>) => void;
};

export default function ExportCodecSettings({
  activeProfile,
  showCodecSettings,
  showAudioSetting,
  updateActiveProfile,
}: ExportCodecSettingsProps) {
  const codecFamily = getCodecFamily(activeProfile.codec);
  const codecProfileOptions = getCodecOptionsForFamily(codecFamily);

  const handleCodecFamilyChange = (family: ExportCodecFamily) => {
    const options = getCodecOptionsForFamily(family);
    const nextCodec = options[0]?.value ?? activeProfile.codec;

    updateActiveProfile({ codec: nextCodec });
  };

  return (
    <>
      {showCodecSettings && (
        <>
          <SettingRow
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

          <SettingRow
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
        <SettingRow
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
    </>
  );
}