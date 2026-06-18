import { ClipItem } from "../../types/domain";

export type ClipContainerProps = {
  cols?: number;
};

export type DeferredProxy = {
  promise: Promise<string>;
  resolve: (proxyPath: string) => void;
  reject: (err: unknown) => void;
};

export type ProxyDemand = {
  order: number; // lower = closer to top
  priority: boolean; // hovered tiles get first dibs
  seq: number; // higher = more recent
};

export type SceneWebpJob = {
  sceneId: string;
  sourcePath: string;
  start: number;
  end: number;
  fps?: number;
  episodeCacheId?: string | null;
  customPath?: string | null;
  kind?: "animated";
};

export type SceneWebpDemand = {
  sceneId: string;
  order: number;
  priority: boolean;
  job: SceneWebpJob;
};

export type LazyClipProps = {
  clip: ClipItem;
  index: number;
  requestProxySequential: (clipPath: string, priority: boolean) => Promise<string>;
  reportProxyDemand: (clipPath: string, demand: { order: number; priority: boolean } | null) => void;
  onClipClick: (
    clipId: string,
    clipSrc: string,
    index: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => void;
  onClipDoubleClick: (
    clipId: string,
    clipSrc: string,
    index: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => void;
  onToggleSelection: (clipId: string, e: React.MouseEvent) => void;
  reportStaggerDemand: (key: string, demand: { order: number; onReady: () => void } | null) => void;
  onDownloadClip: (clip: ClipItem) => void;
  previewWebpPath?: string;
  reportWebpDemand: (
    clipId: string,
    demand: {
      isVisible: boolean;
      order: number;
      priority: boolean;
      job: Omit<SceneWebpJob, "sceneId">;
    } | null
  ) => void;
};