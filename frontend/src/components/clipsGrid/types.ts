import { GeneralSettings } from "../../settings/generalSettings";

export type ClipContainerProps = {
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  cols: number;
  gridPreview: boolean;
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedClips: Set<string>;
  clips: { id: string; src: string; thumbnail: string }[];
  importToken: string;
  loading: boolean;
  isEmpty: boolean;
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
  focusedClip: string | null;
  generalSettings: GeneralSettings;
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
  clip: { id: string; src: string, thumbnail: string };
  index: number;
  importToken: string;
  isExportSelected: boolean;
  isFocused: boolean;
  gridPreview: boolean;
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
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  generalSettings: GeneralSettings;
};