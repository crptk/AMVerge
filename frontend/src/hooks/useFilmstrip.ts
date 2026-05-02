import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

/**
 * Filmstrip sprite-sheet cache.
 *
 * Key   = "<videoPath>|<frameCount>|<thumbW>x<thumbH>|<sourceStart>-<sourceEnd>"
 * Value = the Tauri asset URL for the generated sprite JPEG, or "pending"/"error"
 */
const filmstripCache = new Map<string, string>();

/** Set of keys currently being generated (to avoid duplicate invocations). */
const pendingKeys = new Set<string>();

/** Listeners that want to know when a key finishes generating. */
const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, cb: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  return () => {
    listeners.get(key)?.delete(cb);
    if (listeners.get(key)?.size === 0) listeners.delete(key);
  };
}

function notifyListeners(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

export type FilmstripResult = {
  /** URL to the sprite sheet image (Tauri asset://), or null if not ready yet */
  spriteUrl: string | null;
  /** Number of frames in the sprite sheet */
  frameCount: number;
  /** Width of each individual frame in the sprite sheet */
  thumbWidth: number;
  /** Height of each individual frame in the sprite sheet */
  thumbHeight: number;
  /** Whether the filmstrip is currently being generated */
  loading: boolean;
  /** Error message if generation failed */
  error: string | null;
};

/**
 * THUMB_WIDTH / THUMB_HEIGHT — small enough to be cheap, big enough
 * to look decent in the timeline track (which is typically 80–96px tall).
 */
const DEFAULT_THUMB_W = 160;
const DEFAULT_THUMB_H = 90;

/**
 * Max number of frames per filmstrip sprite.
 * More frames = better temporal coverage but bigger file.
 * 20–30 frames cover a typical clip well without being too large (~200 KB JPEG).
 */
const MAX_FRAMES = 30;
const MIN_FRAMES = 4;

/**
 * Hook that generates (and caches) a horizontal filmstrip sprite sheet
 * for a given video clip. The sprite is produced on the backend via FFmpeg,
 * so the first call triggers an async generation. Subsequent calls for the
 * same video return the cached URL instantly.
 *
 * @param videoPath  Absolute path to the source video file.
 * @param duration   Duration of the clip in seconds.
 * @param segmentWidthPx  Current width of the segment chip in pixels (used to calculate frame count).
 * @param sourceStart  Start time in the source video (for split clips).
 * @param sourceEnd    End time in the source video (for split clips).
 */
export default function useFilmstrip(
  videoPath: string | undefined,
  duration: number,
  segmentWidthPx: number,
  sourceStart?: number,
  sourceEnd?: number
): FilmstripResult {
  // Calculate a reasonable frame count based on segment width.
  // Roughly 1 frame per ~80px of width, clamped to sane bounds.
  const frameCount = Math.max(
    MIN_FRAMES,
    Math.min(MAX_FRAMES, Math.ceil(segmentWidthPx / 80))
  );

  const thumbW = DEFAULT_THUMB_W;
  const thumbH = DEFAULT_THUMB_H;

  // Round source times to avoid cache key churn during minor floating point changes
  const srcStart = sourceStart !== undefined ? Math.round(sourceStart * 100) / 100 : 0;
  const srcEnd = sourceEnd !== undefined ? Math.round(sourceEnd * 100) / 100 : 0;

  const cacheKey = videoPath
    ? `${videoPath}|${frameCount}|${thumbW}x${thumbH}|${srcStart}-${srcEnd}`
    : "";

  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sync from cache when cacheKey changes
  useEffect(() => {
    if (!cacheKey) {
      setSpriteUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = filmstripCache.get(cacheKey);
    if (cached && cached !== "pending" && cached !== "error") {
      setSpriteUrl(cached);
      setLoading(false);
      setError(null);
      return;
    }
    if (cached === "error") {
      setError("Filmstrip generation failed");
      setLoading(false);
      return;
    }

    // Either pending or not started — subscribe for updates
    setLoading(true);
    const unsub = subscribe(cacheKey, () => {
      if (!mountedRef.current) return;
      const val = filmstripCache.get(cacheKey);
      if (val && val !== "pending" && val !== "error") {
        setSpriteUrl(val);
        setLoading(false);
        setError(null);
      } else if (val === "error") {
        setError("Filmstrip generation failed");
        setLoading(false);
      }
    });

    // Kick off generation if not already pending
    if (!pendingKeys.has(cacheKey) && !cached) {
      pendingKeys.add(cacheKey);
      filmstripCache.set(cacheKey, "pending");

      // Derive output dir from the video path's directory
      const lastSlash = Math.max(
        videoPath!.lastIndexOf("\\"),
        videoPath!.lastIndexOf("/")
      );
      const outputDir =
        lastSlash > 0 ? videoPath!.substring(0, lastSlash) : ".";

      // Determine the effective duration and start time for extraction
      const effectiveStartTime = srcStart > 0 ? srcStart : undefined;
      const effectiveDuration = (srcEnd > srcStart && srcStart >= 0)
        ? srcEnd - srcStart
        : duration;

      invoke<string>("generate_filmstrip", {
        videoPath: videoPath!,
        outputDir,
        duration: effectiveDuration,
        frameCount,
        thumbWidth: thumbW,
        thumbHeight: thumbH,
        startTime: effectiveStartTime ?? null,
      })
        .then((spritePath) => {
          const url = convertFileSrc(spritePath);
          filmstripCache.set(cacheKey, url);
          pendingKeys.delete(cacheKey);
          notifyListeners(cacheKey);
        })
        .catch((err) => {
          console.error("[useFilmstrip] Generation failed:", err);
          filmstripCache.set(cacheKey, "error");
          pendingKeys.delete(cacheKey);
          notifyListeners(cacheKey);
        });
    }

    return unsub;
  }, [cacheKey, videoPath, duration, frameCount, thumbW, thumbH, srcStart, srcEnd]);

  return {
    spriteUrl,
    frameCount,
    thumbWidth: thumbW,
    thumbHeight: thumbH,
    loading,
    error,
  };
}