import { SceneWebpJob } from "./types";
import { WebpKind, WebpQueueContext } from "./webpQueueTypes";

export function makeDemandKey(clipId: string, kind: WebpKind): string {
  return `${clipId}::${kind}`;
}

export function parseDemandKey(demandKey: string): { clipId: string; kind: WebpKind } {
  const sep = demandKey.lastIndexOf("::");
  if (sep === -1) return { clipId: demandKey, kind: "animated" };
  const clipId = demandKey.slice(0, sep);
  const kind = demandKey.slice(sep + 2) as WebpKind;
  return { clipId, kind };
}

export function normalizeWebpKind(kind?: string): WebpKind {
  return kind === "poster" ? "poster" : "animated";
}

export function buildDemandJob(
  demandKey: string,
  sourceJob: Omit<SceneWebpJob, "sceneId">,
  kind: WebpKind,
  context: WebpQueueContext
): SceneWebpJob {
  return {
    sceneId: demandKey,
    sourcePath: sourceJob.sourcePath,
    start: sourceJob.start,
    end: sourceJob.end,
    fps: sourceJob.fps,
    kind,
    episodeCacheId: context.episodeCacheId ?? null,
    customPath: context.customPath ?? null,
  };
}
