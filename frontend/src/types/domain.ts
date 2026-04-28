export type ClipItem = {
  id: string;
  src: string;
  thumbnail: string;
  originalName?: string;
};

export type DerushProject = {
  id: string;
  sourceKey: string;
  sourceName: string;
};

export type DerushCategory = {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  isSystem: boolean;
  clipCount: number;
  episodeClipCount?: number;
  projectClipCount?: number;
};

export type DerushSnapshot = {
  project: DerushProject;
  categories: DerushCategory[];
  clipCategoryMap: Record<string, string[]>;
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
