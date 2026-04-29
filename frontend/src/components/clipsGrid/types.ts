import { ThemeSettings } from "../../settings/themeSettings";
import { ClipItem } from "../../types/domain";

export type ClipContainerProps = {
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  userHasHEVC: React.RefObject<boolean>;
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
  registerVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  reportStaggerDemand: (key: string, demand: { order: number; onReady: () => void } | null) => void;
  userHasHEVC: React.RefObject<boolean>;
  onDownloadClip: (clip: ClipItem) => void;
};