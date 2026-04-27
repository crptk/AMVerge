import { invoke } from "@tauri-apps/api/core";

export const truncateFileName = (name: string): string => {
    if (name.length <= 23) return name;
    return name.slice(0, 10) + "..." + name.slice(-10);
};

export const detectScenes = async (videoPath: string, episodeCacheId: string) => {
    // calls backend passing in video file and threshold
    const result = await invoke<string>("detect_scenes", {
      videoPath: videoPath,
      episodeCacheId: episodeCacheId,
    });

    // contains path to all clips along w other metadata
    const scenes = JSON.parse(result);

    // turns to an array of objects
    return scenes.map((s: any) => ({
      id: crypto.randomUUID(),
      src: s.path,
      thumbnail: s.thumbnail,
      originalName: s.original_file,
      originalPath: s.original_path,
      sceneIndex: typeof s.scene_index === "number" ? s.scene_index : undefined,
      startSec: typeof s.start === "number" ? s.start : undefined,
      endSec: typeof s.end === "number" ? s.end : null,
    }));
};

export function fileNameFromPath(path: string): string {
  const last = path.split(/[/\\]/).pop();
  return last || path;
}
