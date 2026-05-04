export type ExportWorkflow =
  | "video_encode"
  | "video_remux"
  | "editor_encode"
  | "editor_remux"
  | "editor_original_xml";

export type ExportCodecFamily = "h264" | "h265" | "av1" | "prores" | "dnxhr" | "cineform";
export type ExportCodec =
  | "h264"
  | "h265"
  | "av1"
  | "prores_422"
  | "prores_4444"
  | "dnxhr_hq"
  | "dnxhr_hqx"
  | "cineform";
export type ExportAudioMode = "copy" | "aac" | "pcm16" | "none";
export type ExportContainer = "mp4" | "mkv" | "mov" | "avi" | "mxf";
export type ExportHardwareMode = "auto" | "gpu" | "cpu";
export type ExportEditorTarget =
  | "none"
  | "premiere_pro"
  | "after_effects"
  | "davinci_resolve"
  | "capcut";
export type ExportProfileIcon =
  | "video"
  | "remux"
  | "premiere"
  | "after_effects"
  | "resolve"
  | "capcut";
export type NvidiaEncoderProfile =
  | "unknown"
  | "blackwell"
  | "ada"
  | "ampere"
  | "turing"
  | "pascal"
  | "maxwell_2"
  | "unsupported";

export type ExportProfile = {
  id: string;
  name: string;
  icon: ExportProfileIcon;
  workflow: ExportWorkflow;
  editorTarget: ExportEditorTarget;
  codec: ExportCodec;
  audioMode: ExportAudioMode;
  container: ExportContainer;
  mergeEnabled: boolean;
  hardwareMode: ExportHardwareMode;
  nvidiaEncoderProfile: NvidiaEncoderProfile;
  parallelExports: number;
};

export const NVIDIA_ENCODER_SUPPORT_MATRIX_URL =
  "https://developer.nvidia.com/video-encode-decode-support-matrix";

export const EXPORT_WORKFLOW_OPTIONS: { value: ExportWorkflow; label: string }[] = [
  { value: "video_encode", label: "Export video (encoding)" },
  { value: "video_remux", label: "Export remux / copy video stream" },
  { value: "editor_encode", label: "Export to editor with re-encode" },
  { value: "editor_remux", label: "Export to editor with remux" },
  { value: "editor_original_xml", label: "Export to editor with original source (XML)" },
];

export const EXPORT_CODEC_OPTIONS: { value: ExportCodec; label: string }[] = [
  { value: "h264", label: "H.264 / AVC" },
  { value: "h265", label: "H.265 / HEVC" },
  { value: "av1", label: "AV1" },
  { value: "prores_422", label: "Apple ProRes 422" },
  { value: "prores_4444", label: "Apple ProRes 4444" },
  { value: "dnxhr_hq", label: "Avid DNxHR HQ" },
  { value: "dnxhr_hqx", label: "Avid DNxHR HQX" },
  { value: "cineform", label: "GoPro CineForm" },
];

export const EXPORT_AUDIO_OPTIONS: { value: ExportAudioMode; label: string }[] = [
  { value: "copy", label: "Keep audio copy" },
  { value: "aac", label: "AAC 192 kbps" },
  { value: "pcm16", label: "PCM 16-bit" },
  { value: "none", label: "No audio" },
];

export const EXPORT_CONTAINER_OPTIONS: { value: ExportContainer; label: string }[] = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "mov", label: "MOV" },
  { value: "avi", label: "AVI" },
  { value: "mxf", label: "MXF" },
];

export const EXPORT_HARDWARE_OPTIONS: { value: ExportHardwareMode; label: string }[] = [
  { value: "auto", label: "Auto GPU / CPU" },
  { value: "gpu", label: "GPU" },
  { value: "cpu", label: "CPU" },
];

export const EXPORT_EDITOR_TARGET_OPTIONS: { value: ExportEditorTarget; label: string }[] = [
  { value: "none", label: "No editor target" },
  { value: "premiere_pro", label: "Premiere Pro" },
  { value: "after_effects", label: "After Effects" },
  { value: "davinci_resolve", label: "DaVinci Resolve" },
  { value: "capcut", label: "CapCut media import" },
];

export const EXPORT_PROFILE_ICON_OPTIONS: { value: ExportProfileIcon; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "remux", label: "Remux" },
  { value: "premiere", label: "Premiere" },
  { value: "after_effects", label: "After Effects" },
  { value: "resolve", label: "Resolve" },
  { value: "capcut", label: "CapCut" },
];

export const NVIDIA_ENCODER_PROFILE_OPTIONS: {
  value: NvidiaEncoderProfile;
  label: string;
  maxParallelExports: number;
  codecs: ExportCodec[];
}[] = [
  {
    value: "unknown",
    label: "Unknown / verify NVIDIA matrix",
    maxParallelExports: 1,
    codecs: ["h264", "h265"],
  },
  {
    value: "blackwell",
    label: "GeForce RTX 50 / Blackwell",
    maxParallelExports: 12,
    codecs: ["h264", "h265", "av1"],
  },
  {
    value: "ada",
    label: "GeForce RTX 40 / Ada",
    maxParallelExports: 12,
    codecs: ["h264", "h265", "av1"],
  },
  {
    value: "ampere",
    label: "GeForce RTX 20/30 / Ampere",
    maxParallelExports: 12,
    codecs: ["h264", "h265"],
  },
  {
    value: "turing",
    label: "GeForce GTX 16 / RTX 20 / Turing",
    maxParallelExports: 12,
    codecs: ["h264", "h265"],
  },
  {
    value: "pascal",
    label: "GeForce GTX 10 / Pascal",
    maxParallelExports: 12,
    codecs: ["h264", "h265"],
  },
  {
    value: "maxwell_2",
    label: "GeForce GTX 900 / Maxwell 2nd Gen",
    maxParallelExports: 12,
    codecs: ["h264"],
  },
  {
    value: "unsupported",
    label: "No supported NVIDIA NVENC",
    maxParallelExports: 1,
    codecs: [],
  },
];

export const DEFAULT_EXPORT_PROFILE_ID = "default-video-encode";

export const DEFAULT_EXPORT_PROFILE: ExportProfile = {
  id: DEFAULT_EXPORT_PROFILE_ID,
  name: "Default MP4",
  icon: "video",
  workflow: "video_encode",
  editorTarget: "none",
  codec: "h264",
  audioMode: "pcm16",
  container: "mp4",
  mergeEnabled: true,
  hardwareMode: "auto",
  nvidiaEncoderProfile: "unknown",
  parallelExports: 1,
};

export const DEFAULT_EXPORT_PROFILES: ExportProfile[] = [
  DEFAULT_EXPORT_PROFILE,
  {
    id: "prores-422-master",
    name: "ProRes 422",
    icon: "premiere",
    workflow: "video_encode",
    editorTarget: "none",
    codec: "prores_422",
    audioMode: "pcm16",
    container: "mov",
    mergeEnabled: true,
    hardwareMode: "cpu",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
  {
    id: "dnxhr-hqx-master",
    name: "DNxHR HQX",
    icon: "resolve",
    workflow: "video_encode",
    editorTarget: "none",
    codec: "dnxhr_hqx",
    audioMode: "pcm16",
    container: "mov",
    mergeEnabled: true,
    hardwareMode: "cpu",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
  {
    id: "remux-fast-mov",
    name: "Fast Remux MOV",
    icon: "remux",
    workflow: "video_remux",
    editorTarget: "none",
    codec: "h264",
    audioMode: "copy",
    container: "mov",
    mergeEnabled: false,
    hardwareMode: "cpu",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
  {
    id: "premiere-original-xml",
    name: "Premiere XML",
    icon: "premiere",
    workflow: "editor_original_xml",
    editorTarget: "premiere_pro",
    codec: "h264",
    audioMode: "copy",
    container: "mp4",
    mergeEnabled: false,
    hardwareMode: "cpu",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
];

const CODEC_LABELS: Record<ExportCodec, string> = {
  h264: "H.264",
  h265: "H.265",
  av1: "AV1",
  prores_422: "ProRes 422",
  prores_4444: "ProRes 4444",
  dnxhr_hq: "DNxHR HQ",
  dnxhr_hqx: "DNxHR HQX",
  cineform: "CineForm",
};

const AUDIO_MODE_LABELS: Record<ExportAudioMode, string> = {
  copy: "Audio copy",
  aac: "AAC",
  pcm16: "PCM 16-bit",
  none: "No audio",
};

const EDITOR_TARGET_LABELS: Record<ExportEditorTarget, string> = {
  none: "No editor",
  premiere_pro: "Premiere Pro",
  after_effects: "After Effects",
  davinci_resolve: "DaVinci Resolve",
  capcut: "CapCut",
};

export function getExportCodecLabel(codec: ExportCodec): string {
  return CODEC_LABELS[codec];
}

const CODEC_FAMILY_LABELS: Record<ExportCodecFamily, string> = {
  h264: "H.264 / AVC",
  h265: "H.265 / HEVC",
  av1: "AV1",
  prores: "ProRes",
  dnxhr: "DNxHD / DNxHR",
  cineform: "CineForm",
};

const CODEC_FAMILY_TO_CODECS: Record<ExportCodecFamily, ExportCodec[]> = {
  h264: ["h264"],
  h265: ["h265"],
  av1: ["av1"],
  prores: ["prores_422", "prores_4444"],
  dnxhr: ["dnxhr_hq", "dnxhr_hqx"],
  cineform: ["cineform"],
};

export const EXPORT_CODEC_FAMILY_OPTIONS: { value: ExportCodecFamily; label: string }[] = (
  Object.keys(CODEC_FAMILY_LABELS) as ExportCodecFamily[]
).map((family) => ({
  value: family,
  label: CODEC_FAMILY_LABELS[family],
}));

export function getCodecFamily(codec: ExportCodec): ExportCodecFamily {
  if (codec === "prores_422" || codec === "prores_4444") return "prores";
  if (codec === "dnxhr_hq" || codec === "dnxhr_hqx") return "dnxhr";
  if (codec === "cineform") return "cineform";
  if (codec === "av1") return "av1";
  if (codec === "h265") return "h265";
  return "h264";
}

export function getCodecOptionsForFamily(
  family: ExportCodecFamily
): { value: ExportCodec; label: string }[] {
  const allowed = CODEC_FAMILY_TO_CODECS[family];
  return EXPORT_CODEC_OPTIONS.filter((option) => allowed.includes(option.value));
}

export function getExportProfileSummary(profile: ExportProfile): string {
  const codecLabel = usesEncoding(profile.workflow)
    ? getExportCodecLabel(profile.codec) || "Unknown codec"
    : "Stream copy";
  const audioLabel = AUDIO_MODE_LABELS[profile.audioMode] || "Audio copy";
  const containerLabel = profile.container.toUpperCase();

  if (usesEditorTarget(profile.workflow)) {
    const editor = EDITOR_TARGET_LABELS[profile.editorTarget];
    return `${editor} • ${codecLabel} • ${audioLabel} • ${containerLabel}`;
  }

  return `${codecLabel} • ${audioLabel} • ${containerLabel}`;
}

export function getActiveExportProfile(
  profiles: ExportProfile[],
  activeProfileId: string
): ExportProfile {
  return profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? DEFAULT_EXPORT_PROFILE;
}

export function usesEncoding(workflow: ExportWorkflow): boolean {
  return workflow === "video_encode" || workflow === "editor_encode";
}

export function usesEditorTarget(workflow: ExportWorkflow): boolean {
  return workflow === "editor_encode" || workflow === "editor_remux" || workflow === "editor_original_xml";
}

export function getNvidiaEncoderProfile(profile: NvidiaEncoderProfile) {
  return (
    NVIDIA_ENCODER_PROFILE_OPTIONS.find((option) => option.value === profile) ??
    NVIDIA_ENCODER_PROFILE_OPTIONS[0]
  );
}

export function getParallelExportLimit(profile: ExportProfile): number {
  if (!usesEncoding(profile.workflow) || profile.hardwareMode === "cpu") return 1;

  const support = getNvidiaEncoderProfile(profile.nvidiaEncoderProfile);
  if (!support.codecs.includes(profile.codec)) return 1;

  return Math.max(1, support.maxParallelExports);
}

export function normalizeExportProfile(profile: ExportProfile): ExportProfile {
  const limit = getParallelExportLimit(profile);
  const parallelExports = Math.max(1, Math.min(limit, Math.round(profile.parallelExports || 1)));
  const editorTarget = usesEditorTarget(profile.workflow) ? profile.editorTarget : "none";
  const hardwareMode = usesEncoding(profile.workflow) ? profile.hardwareMode : "cpu";

  return {
    ...profile,
    name: profile.name,
    editorTarget,
    hardwareMode,
    parallelExports,
  };
}

export function createExportProfile(index: number): ExportProfile {
  return normalizeExportProfile({
    ...DEFAULT_EXPORT_PROFILE,
    id: `export-profile-${Date.now()}-${index}`,
    name: `Export Profile ${index}`,
  });
}
