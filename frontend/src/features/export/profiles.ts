export type ExportWorkflow =
  | "video_encode"
  | "video_remux";

export type ExportCodecFamily =
  | "h264"
  | "h265"
  | "av1"
  | "prores";

export type ExportCodec =
  | "h264_main"
  | "h264_high"
  | "h264_high10"
  | "h264_high422"
  | "h265_main"
  | "h265_main10"
  | "h265_main12"
  | "h265_main422_10"
  | "av1_main"
  | "prores_422_lt"
  | "prores_422"
  | "prores_422_hq"
  | "prores_4444"
  | "prores_4444_xq"
  // legacy values kept for persisted data compatibility
  | "h264"
  | "h265"
  | "av1";

export type ExportAudioMode =
  | "copy"
  | "aac"
  | "aac_320"
  | "pcm16"
  | "pcm24"
  | "flac"
  | "alac"
  | "opus"
  | "mp3"
  | "none";
export type ExportContainer = "mp4" | "mkv" | "mov" | "mxf";
export type ExportHardwareMode = "auto" | "gpu" | "cpu";
export type ExportEditorTarget =
  | "none";
export type ExportProfileIcon =
  | "video"
  | "remux"
  | "h264"
  | "h265"
  | "prores"
  | "custom";
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
  customIconPath?: string | null;
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

export type NvidiaDetectionResult = {
  hasNvidiaGpu: boolean;
  gpuName: string | null;
  profile: NvidiaEncoderProfile;
};

export type GpuEncoderCapabilities = {
  hasGpuEncoder: boolean;
  preferredBackend: string;
  availableBackends: string[];
  availableVideoEncoders: string[];
  h264Encoder: string | null;
  h265Encoder: string | null;
  av1Encoder: string | null;
  maxParallelExports: number;
};

export const SAFE_DEFAULT_PARALLEL_EXPORTS = 8;

export const NVIDIA_ENCODER_SUPPORT_MATRIX_URL =
  "https://developer.nvidia.com/video-encode-decode-support-matrix";

export const EXPORT_WORKFLOW_OPTIONS: { value: ExportWorkflow; label: string }[] = [
  { value: "video_encode", label: "Export video (re-encode)" },
  { value: "video_remux", label: "Export video (stream copy / remux)" },
];

export const EXPORT_CODEC_OPTIONS: { value: ExportCodec; label: string }[] = [
  { value: "h264_main", label: "H.264 / AVC - Main" },
  { value: "h264_high", label: "H.264 / AVC - High" },
  { value: "h264_high10", label: "H.264 / AVC - High 10" },
  { value: "h264_high422", label: "H.264 / AVC - High 4:2:2" },
  { value: "h265_main", label: "H.265 / HEVC - Main" },
  { value: "h265_main10", label: "H.265 / HEVC - Main 10" },
  { value: "h265_main12", label: "H.265 / HEVC - Main 12" },
  { value: "h265_main422_10", label: "H.265 / HEVC - Main 4:2:2 10" },
  { value: "prores_422_lt", label: "ProRes 422 LT" },
  { value: "prores_422", label: "ProRes 422" },
  { value: "prores_422_hq", label: "ProRes 422 HQ" },
  { value: "prores_4444", label: "ProRes 4444" },
  { value: "prores_4444_xq", label: "ProRes 4444 XQ" },
];

export const EXPORT_AUDIO_OPTIONS: { value: ExportAudioMode; label: string }[] = [
  { value: "copy", label: "Keep audio copy" },
  { value: "aac", label: "AAC 192 kbps" },
  { value: "aac_320", label: "AAC 320 kbps" },
  { value: "pcm16", label: "PCM 16-bit" },
  { value: "pcm24", label: "PCM 24-bit" },
  { value: "flac", label: "FLAC lossless" },
  { value: "alac", label: "ALAC lossless" },
  { value: "opus", label: "Opus 160 kbps" },
  { value: "mp3", label: "MP3 320 kbps" },
  { value: "none", label: "No audio" },
];

export const EXPORT_CONTAINER_OPTIONS: { value: ExportContainer; label: string }[] = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "mov", label: "MOV" },
];

export const EXPORT_HARDWARE_OPTIONS: { value: ExportHardwareMode; label: string }[] = [
  { value: "auto", label: "Auto GPU / CPU" },
  { value: "gpu", label: "GPU" },
  { value: "cpu", label: "CPU" },
];

export const EXPORT_PROFILE_ICON_OPTIONS: { value: ExportProfileIcon; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "remux", label: "Remux" },
  { value: "h264", label: "H.264" },
  { value: "h265", label: "H.265" },
  { value: "prores", label: "ProRes" },
  { value: "custom", label: "Custom" },
];

const EXPORT_PROFILE_ICON_VALUES: ExportProfileIcon[] = [
  "video",
  "remux",
  "h264",
  "h265",
  "prores",
  "custom",
];

const LEGACY_PROFILE_ICON_MAP: Record<string, ExportProfileIcon> = {
  av1: "h265",
  cineform: "prores",
  dnxhr: "prores",
  uncompressed: "prores",
  premiere: "video",
  after_effects: "video",
  resolve: "video",
  capcut: "video",
};

const LEGACY_WORKFLOW_MAP: Record<string, ExportWorkflow> = {
  editor_encode: "video_encode",
  editor_remux: "video_remux",
};

export const NVIDIA_ENCODER_PROFILE_OPTIONS: {
  value: NvidiaEncoderProfile;
  label: string;
  maxParallelExports: number;
  supportedCodecs: ExportCodec[];
}[] = [
  {
    value: "unknown",
    label: "Unknown / verify NVIDIA matrix",
    maxParallelExports: 1,
    supportedCodecs: ["h264_main", "h264_high", "h265_main", "h265_main10"],
  },
  {
    value: "blackwell",
    label: "GeForce RTX 50 / Blackwell",
    maxParallelExports: 12,
    supportedCodecs: [
      "h264_main",
      "h264_high",
      "h264_high10",
      "h264_high422",
      "h265_main",
      "h265_main10",
      "h265_main12",
      "h265_main422_10",
      "av1_main",
    ],
  },
  {
    value: "ada",
    label: "GeForce RTX 40 / Ada",
    maxParallelExports: 12,
    supportedCodecs: ["h264_main", "h264_high", "h265_main", "h265_main10", "av1_main"],
  },
  {
    value: "ampere",
    label: "GeForce RTX 30 / Ampere",
    maxParallelExports: 12,
    supportedCodecs: ["h264_main", "h264_high", "h265_main", "h265_main10"],
  },
  {
    value: "turing",
    label: "GeForce GTX 16 / RTX 20 / Turing",
    maxParallelExports: 6,
    supportedCodecs: ["h264_main", "h264_high", "h265_main", "h265_main10"],
  },
  {
    value: "pascal",
    label: "GeForce GTX 10 / Pascal",
    maxParallelExports: 4,
    supportedCodecs: ["h264_main", "h264_high", "h265_main", "h265_main10"],
  },
  {
    value: "maxwell_2",
    label: "GeForce GTX 900 / Maxwell 2nd Gen",
    maxParallelExports: 2,
    supportedCodecs: ["h264_main", "h264_high"],
  },
  {
    value: "unsupported",
    label: "No supported NVIDIA NVENC",
    maxParallelExports: 1,
    supportedCodecs: [],
  },
];

export const DEFAULT_EXPORT_PROFILE_ID = "default-video-encode";

export const DEFAULT_EXPORT_PROFILE: ExportProfile = {
  id: DEFAULT_EXPORT_PROFILE_ID,
  name: "Default MP4",
  icon: "video",
  workflow: "video_encode",
  editorTarget: "none",
  codec: "h264_high",
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
    id: "h265-main10-master",
    name: "H.265 Main10",
    icon: "h265",
    workflow: "video_encode",
    editorTarget: "none",
    codec: "h265_main10",
    audioMode: "aac",
    container: "mp4",
    mergeEnabled: true,
    hardwareMode: "auto",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
  {
    id: "prores-422-hq-master",
    name: "ProRes 422 HQ",
    icon: "prores",
    workflow: "video_encode",
    editorTarget: "none",
    codec: "prores_422_hq",
    audioMode: "pcm16",
    container: "mov",
    mergeEnabled: true,
    hardwareMode: "cpu",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
  {
    id: "prores-4444-master",
    name: "ProRes 4444",
    icon: "prores",
    workflow: "video_encode",
    editorTarget: "none",
    codec: "prores_4444",
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
    codec: "h264_high",
    audioMode: "copy",
    container: "mov",
    mergeEnabled: false,
    hardwareMode: "cpu",
    nvidiaEncoderProfile: "unknown",
    parallelExports: 1,
  },
];

const CODEC_LABELS: Record<ExportCodec, string> = {
  h264_main: "H.264 Main",
  h264_high: "H.264 High",
  h264_high10: "H.264 High 10",
  h264_high422: "H.264 High 4:2:2",
  h265_main: "H.265 Main",
  h265_main10: "H.265 Main 10",
  h265_main12: "H.265 Main 12",
  h265_main422_10: "H.265 Main 4:2:2 10",
  av1_main: "AV1 Main",
  prores_422_lt: "ProRes 422 LT",
  prores_422: "ProRes 422",
  prores_422_hq: "ProRes 422 HQ",
  prores_4444: "ProRes 4444",
  prores_4444_xq: "ProRes 4444 XQ",
  h264: "H.264 High",
  h265: "H.265 Main",
  av1: "AV1 Main",
};

const AUDIO_MODE_LABELS: Record<ExportAudioMode, string> = {
  copy: "Audio copy",
  aac: "AAC",
  aac_320: "AAC 320k",
  pcm16: "PCM 16-bit",
  pcm24: "PCM 24-bit",
  flac: "FLAC",
  alac: "ALAC",
  opus: "Opus",
  mp3: "MP3",
  none: "No audio",
};

const CODEC_FAMILY_LABELS: Record<ExportCodecFamily, string> = {
  h264: "H.264 / AVC",
  h265: "H.265 / HEVC",
  av1: "AV1",
  prores: "ProRes",
};

const CODEC_FAMILY_TO_CODECS: Record<ExportCodecFamily, ExportCodec[]> = {
  h264: ["h264_main", "h264_high", "h264_high10", "h264_high422"],
  h265: ["h265_main", "h265_main10", "h265_main12", "h265_main422_10"],
  av1: ["av1_main"],
  prores: ["prores_422_lt", "prores_422", "prores_422_hq", "prores_4444", "prores_4444_xq"],
};

const LEGACY_CODEC_MAP: Record<string, ExportCodec> = {
  h264: "h264_high",
  h265: "h265_main",
  av1: "h265_main",
  av1_main: "h265_main",
  cineform: "h264_high",
  dnxhr_lb: "h264_high",
  dnxhr_sq: "h264_high",
  dnxhr_hq: "h264_high",
  dnxhr_hqx: "h264_high",
  dnxhr_444: "h264_high",
  uncompressed_rgb8: "h264_high",
  uncompressed_rgb10: "h264_high",
  uncompressed_rgba8: "h264_high",
  uncompressed_rgba16: "h264_high",
};

const LEGACY_AUDIO_MODE_MAP: Record<string, ExportAudioMode> = {
  aac192: "aac",
  aac_192: "aac",
  pcm: "pcm16",
  pcm_s16: "pcm16",
  opus_160: "opus",
  mp3_320: "mp3",
};

export const EXPORT_CODEC_FAMILY_OPTIONS: { value: ExportCodecFamily; label: string }[] = (
  Object.keys(CODEC_FAMILY_LABELS) as ExportCodecFamily[]
).filter((family) => family !== "av1")
  .map((family) => ({
    value: family,
    label: CODEC_FAMILY_LABELS[family],
  }));

export function coerceExportCodec(codec: string | undefined | null): ExportCodec {
  if (!codec) return "h264_high";
  if ((EXPORT_CODEC_OPTIONS as { value: string }[]).some((option) => option.value === codec)) {
    return codec as ExportCodec;
  }
  return LEGACY_CODEC_MAP[codec] ?? "h264_high";
}

export function coerceExportProfileIcon(icon: string | undefined | null): ExportProfileIcon {
  if (!icon) return "video";
  if ((EXPORT_PROFILE_ICON_VALUES as string[]).includes(icon)) {
    return icon as ExportProfileIcon;
  }
  return LEGACY_PROFILE_ICON_MAP[icon] ?? "video";
}

export function coerceExportAudioMode(audioMode: string | undefined | null): ExportAudioMode {
  if (!audioMode) return "copy";
  if ((EXPORT_AUDIO_OPTIONS as { value: string }[]).some((option) => option.value === audioMode)) {
    return audioMode as ExportAudioMode;
  }
  return LEGACY_AUDIO_MODE_MAP[audioMode] ?? "copy";
}

export function getExportCodecLabel(codec: ExportCodec): string {
  return CODEC_LABELS[codec] ?? "Unknown codec";
}

export function getCodecFamily(codec: ExportCodec): ExportCodecFamily {
  const normalized = coerceExportCodec(codec);

  if (normalized.startsWith("h264_")) return "h264";
  if (normalized.startsWith("h265_")) return "h265";
  if (normalized === "av1_main") return "h265";
  if (normalized.startsWith("prores_")) return "prores";
  return "h264";
}

export function getCodecOptionsForFamily(
  family: ExportCodecFamily
): { value: ExportCodec; label: string }[] {
  const allowed = CODEC_FAMILY_TO_CODECS[family];
  return EXPORT_CODEC_OPTIONS.filter((option) => allowed.includes(option.value));
}

export function coerceExportContainer(container: string | undefined | null): ExportContainer {
  if (!container) return "mp4";
  if ((EXPORT_CONTAINER_OPTIONS as { value: string }[]).some((option) => option.value === container)) {
    return container as ExportContainer;
  }
  return "mp4";
}

export function usesEncoding(workflow: ExportWorkflow): boolean {
  return workflow === "video_encode";
}

export function usesEditorTarget(workflow: ExportWorkflow): boolean {
  switch (workflow) {
    case "video_encode":
    case "video_remux":
      return false;
    default:
      return false;
  }
}

export function supportsClipMerge(workflow: ExportWorkflow): boolean {
  switch (workflow) {
    case "video_encode":
    case "video_remux":
      return true;
    default:
      return false;
  }
}

export function supportsAudioMode(workflow: ExportWorkflow): boolean {
  switch (workflow) {
    case "video_encode":
    case "video_remux":
      return true;
    default:
      return false;
  }
}

export function supportsContainerSelection(workflow: ExportWorkflow): boolean {
  switch (workflow) {
    case "video_encode":
    case "video_remux":
      return true;
    default:
      return false;
  }
}

export function isQuickDownloadCompatibleWorkflow(workflow: ExportWorkflow): boolean {
  switch (workflow) {
    case "video_encode":
    case "video_remux":
      return true;
    default:
      return false;
  }
}

export function isExportCodecContainerCompatible(
  codec: ExportCodec,
  container: ExportContainer
): boolean {
  const family = getCodecFamily(codec);

  switch (container) {
    case "mp4":
      return family === "h264" || family === "h265" || family === "av1";
    case "mov":
      return family === "h264" || family === "h265" || family === "av1" || family === "prores";
    case "mkv":
      return true;
    case "mxf":
      return family === "prores";
    default:
      return true;
  }
}

export function getRecommendedContainerForCodec(codec: ExportCodec): ExportContainer {
  const family = getCodecFamily(codec);
  if (family === "prores") return "mov";
  return "mp4";
}

export function coerceExportWorkflow(workflow: string | undefined | null): ExportWorkflow {
  if (!workflow) return "video_encode";
  if (workflow === "video_encode" || workflow === "video_remux") {
    return workflow;
  }
  return LEGACY_WORKFLOW_MAP[workflow] ?? "video_encode";
}

export function getNvidiaEncoderProfile(profile: NvidiaEncoderProfile) {
  return (
    NVIDIA_ENCODER_PROFILE_OPTIONS.find((option) => option.value === profile) ??
    NVIDIA_ENCODER_PROFILE_OPTIONS[0]
  );
}

export function inferNvidiaProfileFromGpuName(gpuName: string | null | undefined): NvidiaEncoderProfile {
  const normalized = (gpuName ?? "").trim().toLowerCase();
  if (!normalized.includes("nvidia")) return "unsupported";

  if (normalized.includes("rtx 50") || normalized.includes("blackwell")) return "blackwell";
  if (
    normalized.includes("rtx 40") ||
    normalized.includes(" ada") ||
    normalized.includes(" l40") ||
    normalized.includes(" l4")
  ) {
    return "ada";
  }
  if (
    normalized.includes("rtx 30") ||
    normalized.includes("rtx a2000") ||
    normalized.includes("rtx a3000") ||
    normalized.includes("rtx a4000") ||
    normalized.includes("rtx a4500") ||
    normalized.includes("rtx a5000") ||
    normalized.includes("rtx a5500") ||
    normalized.includes("rtx a6000") ||
    normalized.includes("a10") ||
    normalized.includes("a16") ||
    normalized.includes("a2") ||
    normalized.includes("a30") ||
    normalized.includes("a40") ||
    normalized.includes("ampere")
  ) {
    return "ampere";
  }
  if (
    normalized.includes("rtx 20") ||
    normalized.includes("gtx 16") ||
    normalized.includes("titan rtx") ||
    normalized.includes("quadro rtx") ||
    normalized.includes("t4") ||
    normalized.includes("turing")
  ) {
    return "turing";
  }
  if (normalized.includes("gtx 10") || normalized.includes("p40") || normalized.includes("p4") || normalized.includes("pascal")) {
    return "pascal";
  }
  if (normalized.includes("gtx 9") || normalized.includes("maxwell")) return "maxwell_2";

  return "unknown";
}

export function isCodecGpuEligible(codec: ExportCodec): boolean {
  const normalized = coerceExportCodec(codec);
  return (
    normalized === "h264_main" ||
    normalized === "h264_high" ||
    normalized === "h264_high10" ||
    normalized === "h264_high422" ||
    normalized === "h265_main" ||
    normalized === "h265_main10" ||
    normalized === "h265_main12" ||
    normalized === "h265_main422_10" ||
    normalized === "av1_main"
  );
}

export const isCodecNvencEligible = isCodecGpuEligible;

export function isCodecSupportedByNvidiaProfile(
  codec: ExportCodec,
  nvidiaProfile: NvidiaEncoderProfile
): boolean {
  const support = getNvidiaEncoderProfile(nvidiaProfile);
  return support.supportedCodecs.includes(coerceExportCodec(codec));
}

export function getParallelExportLimit(profile: ExportProfile): number {
  if (!usesEncoding(profile.workflow) || profile.hardwareMode === "cpu") return 1;

  const codec = coerceExportCodec(profile.codec);
  if (!isCodecGpuEligible(codec)) return 1;

  const support = getNvidiaEncoderProfile(profile.nvidiaEncoderProfile);
  if (support.value === "unknown" || support.value === "unsupported") return 1;
  if (!support.supportedCodecs.includes(codec)) return 1;

  return Math.max(1, support.maxParallelExports);
}

export function getExportProfileSummary(profile: ExportProfile): string {
  const codec = coerceExportCodec(profile.codec);
  const codecLabel = usesEncoding(profile.workflow)
    ? getExportCodecLabel(codec)
    : "Stream copy";
  const audioLabel = AUDIO_MODE_LABELS[profile.audioMode] || "Audio copy";
  const containerLabel = profile.container.toUpperCase();

  return `${codecLabel} • ${audioLabel} • ${containerLabel}`;
}

export function getActiveExportProfile(
  profiles: ExportProfile[],
  activeProfileId: string
): ExportProfile {
  return profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? DEFAULT_EXPORT_PROFILE;
}

export function normalizeExportProfile(profile: ExportProfile): ExportProfile {
  const workflow: ExportWorkflow = coerceExportWorkflow(profile.workflow as string | undefined);
  const codec = coerceExportCodec(profile.codec);
  const icon = coerceExportProfileIcon((profile.icon as string | undefined) ?? null);
  const customIconPath =
    typeof profile.customIconPath === "string" && profile.customIconPath.trim() !== ""
      ? profile.customIconPath
      : null;
  const editorTarget: ExportEditorTarget = "none";
  let container = coerceExportContainer(profile.container);

  if (usesEncoding(workflow) && !isExportCodecContainerCompatible(codec, container)) {
    container = getRecommendedContainerForCodec(codec);
  }

  const nvidiaEncoderProfile = profile.nvidiaEncoderProfile || "unknown";

  let hardwareMode: ExportHardwareMode = usesEncoding(workflow)
    ? profile.hardwareMode || "auto"
    : "cpu";

  if (hardwareMode !== "cpu" && !isCodecGpuEligible(codec)) {
    hardwareMode = "cpu";
  }

  const normalized: ExportProfile = {
    ...profile,
    icon: icon === "custom" && !customIconPath ? "video" : icon,
    customIconPath,
    workflow,
    codec,
    editorTarget,
    hardwareMode,
    nvidiaEncoderProfile,
    name: typeof profile.name === "string" ? profile.name : "Export Profile",
    audioMode: coerceExportAudioMode(profile.audioMode),
    container,
    mergeEnabled: profile.mergeEnabled ?? false,
    parallelExports: Number.isFinite(profile.parallelExports) ? profile.parallelExports : 1,
  };

  const limit = getParallelExportLimit(normalized);
  const parallelExports = Math.max(1, Math.min(limit, Math.round(normalized.parallelExports || 1)));

  return {
    ...normalized,
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
