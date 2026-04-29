import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export type FrameInfo = {
  frameCount: number;
  fps: number;
  cachePath: string | null;
};

// Cache promises to avoid concurrent ffmpeg extractions for the same clip
const infoPromises = new Map<string, Promise<[number, number]>>();
const extractionPromises = new Map<string, Promise<string>>();

export default function useHighPrecisionFilmstrip(videoPath: string | undefined, cacheId: string | undefined) {
  const [info, setInfo] = useState<FrameInfo | null>(null);

  useEffect(() => {
    if (!videoPath || !cacheId) return;
    
    let isMounted = true;

    async function loadInfo() {
      try {
        let infoPromise = infoPromises.get(videoPath!);
        if (!infoPromise) {
            infoPromise = invoke<[number, number]>("get_video_frame_info", { videoPath });
            infoPromises.set(videoPath!, infoPromise);
        }
        const [frames, fps] = await infoPromise;
        
        let extPromise = extractionPromises.get(cacheId!);
        if (!extPromise) {
            extPromise = invoke<string>("extract_video_frames", { videoPath, cacheId, width: 80 });
            extractionPromises.set(cacheId!, extPromise);
        }
        const cachePath = await extPromise;
        
        if (isMounted) {
            setInfo({ frameCount: frames, fps, cachePath });
        }
      } catch (err) {
        console.error("[useHighPrecisionFilmstrip] Failed to load info:", err);
        infoPromises.delete(videoPath!);
        extractionPromises.delete(cacheId!);
      }
    }

    loadInfo();
    
    return () => {
        isMounted = false;
    };
  }, [videoPath, cacheId]);

  return info;
}
