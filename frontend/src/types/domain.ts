export type ClipItem = {
  id: string;
  src: string;
  srcList?: string[];
  thumbnail: string;
  originalName?: string;
  thumbnailReady?: boolean;
  mergedSrcs?: string[];
  start?: number;
  end?: number;
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
};