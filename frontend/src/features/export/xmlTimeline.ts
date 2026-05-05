import { ClipItem } from "../../types/domain";

export type TimelineXmlClip = {
  id: string;
  src: string;
  originalName?: string;
  originalPath?: string;
  sceneIndex?: number;
  startSec?: number;
  endSec?: number | null;
};

export const sanitizeTimelineName = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "timeline";

export const buildTimelineXmlClips = (
  selected: ClipItem[],
  importedVideoPath: string | null
): TimelineXmlClip[] => {
  const fallbackOriginalPath =
    selected.find((clip) => !!clip.originalPath)?.originalPath ??
    importedVideoPath ??
    undefined;

  return selected.map((clip) => ({
    id: clip.id,
    src: clip.src,
    originalName: clip.originalName,
    originalPath: clip.originalPath ?? fallbackOriginalPath,
    sceneIndex: clip.sceneIndex,
    startSec: clip.startSec ?? clip.start,
    endSec: clip.endSec ?? clip.end ?? null,
  }));
};

export const resolveTimelineName = (
  selected: ClipItem[],
  mergeFileName?: string
): string => {
  if (mergeFileName?.trim()) {
    return sanitizeTimelineName(mergeFileName);
  }
  const inferred = selected[0]?.originalName || "episode_timeline";
  return sanitizeTimelineName(inferred);
};

export const buildXmlSavePath = (outputDir: string, timelineName: string): string => {
  const separator = outputDir.includes("\\") ? "\\" : "/";
  return `${outputDir}${separator}${timelineName}.xml`;
};
