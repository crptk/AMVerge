import { invoke } from "@tauri-apps/api/core";

export const truncateFileName = (name: string): string => {
    if (name.length <= 23) return name;
    return name.slice(0, 10) + "..." + name.slice(-10);
};

export const detectScenes = async (
  videoPath: string,
  episodeCacheId: string,
  customPath: string | null = null
) => {
    // calls backend passing in video file and threshold
    const result = await invoke<string>("detect_scenes", {
      videoPath: videoPath,
      episodeCacheId: episodeCacheId,
      customPath: customPath,
    });

    // contains path to all clips along w other metadata
    const scenes = JSON.parse(result);

    // turns to an array of objects
    return scenes.map((s: any) => ({
      id: crypto.randomUUID(),
      src: s.path,
      thumbnail: s.thumbnail,
      originalName: s.original_file
    }));
};

export function fileNameFromPath(path: string): string {
  const last = path.split(/[/\\]/).pop();
  return last || path;
}

export function remapPathRoot(path: string, oldRoot: string, newRoot: string): string {
  const normalize = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  const displayNormalize = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "");

  const normalizedPath = normalize(path);
  const normalizedOldRoot = normalize(oldRoot);
  const cleanNewRoot = displayNormalize(newRoot);

  if (
    normalizedPath !== normalizedOldRoot &&
    !normalizedPath.startsWith(normalizedOldRoot + "/")
  ) {
    return path;
  }

  const cleanOriginalPath = displayNormalize(path);
  const relativePath = cleanOriginalPath.slice(displayNormalize(oldRoot).length);

  return cleanNewRoot + relativePath;
}