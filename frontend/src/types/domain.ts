export type ClipItem = {
  id: string;
  src: string;
  srcList?: string[];
  thumbnail: string;
  originalName?: string;
  originalPath?: string;
  sceneIndex?: number;
  startSec?: number;
  endSec?: number | null;
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
