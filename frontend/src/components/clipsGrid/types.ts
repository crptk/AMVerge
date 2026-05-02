import { ClipItem } from "../../types/domain";

export type ClipContainerProps = {
  gridRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  setTimelineClipIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  timelineClipIds: Set<string>;
  userHasHEVC: React.RefObject<boolean>;
  isSelected: boolean;
  onDownloadClip: (clip: ClipItem) => void;
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

export type LazyClipProps = {
  clip: ClipItem;
  index: number;
  isExportSelected: boolean;
  isSelected: boolean;
  isFocused: boolean;
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
  onToggleTimeline: (clipId: string, e: React.MouseEvent) => void;
  onToggleSelection: (clipId: string, selected: boolean) => void;
  registerVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  reportStaggerDemand: (key: string, demand: { order: number; onReady: () => void } | null) => void;
  userHasHEVC: React.RefObject<boolean>;
  onDownloadClip: (clip: ClipItem) => void;
};