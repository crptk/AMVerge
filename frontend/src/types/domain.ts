export type ClipItem = {
  id: string;
  src: string;
  srcList?: string[];
  thumbnail: string;
  originalName?: string;
  originalPath?: string;
  sceneIndex?: number;
  startSec?: number;
  endSec?: number;
  thumbnailReady?: boolean;
  mergedSrcs?: string[];
  clipPath?: string;
  clipMode?: string;
};

export type EpisodeFolder = {
  id: string;
  name: string;
  parentId: string | null;
  isExpanded: boolean;
};

export type EpisodeEntry = {
  id: string;
  displayName: string;
  videoPath: string;
  folderId: string | null;
  importedAt: number;
  clips: ClipItem[];
  // How this episode was imported. Fixed at import time — the global
  // import-method setting only affects new imports, not existing episodes.
  importMethod?: "video_files" | "webp_files";
};
