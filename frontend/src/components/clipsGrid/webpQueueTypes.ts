import { SceneWebpJob } from "./types";

export type WebpKind = "animated";

export type QueueDemand = {
  demandKey: string;
  clipId: string;
  kind: WebpKind;
  isVisible: boolean;
  order: number;
  priority: boolean;
  seq: number;
  job: SceneWebpJob;
};

export type WebpDemandInput = {
  isVisible: boolean;
  order: number;
  priority: boolean;
  job: Omit<SceneWebpJob, "sceneId">;
};

export type SceneWebpBatchItem = {
  sceneId: string;
  path?: string;
  duration?: number;
  cached: boolean;
  error?: string;
};

export type SceneWebpBatchResult = {
  items: SceneWebpBatchItem[];
};

export type WebpQueueContext = {
  episodeCacheId?: string | null;
  customPath?: string | null;
};

export type WebpPrimeJob = {
  clipId: string;
  sourcePath: string;
  start: number;
  end: number;
  fps?: number;
};
