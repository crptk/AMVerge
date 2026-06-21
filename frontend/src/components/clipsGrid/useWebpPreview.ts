/**
 * useWebpPreview.ts
 *
 * All WebP-preview-mode logic for a clip tile, kept separate from the video
 * playback logic in LazyClip. Owns the static thumbnail state, the animated
 * WebP source, and the viewport/hover demand reporting that drives WebP
 * generation. Returns only what the tile needs to render its WebP layers.
 */
import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ClipItem } from "../../types/domain";
import { SceneWebpJob } from "./types";

const WEBP_THUMBNAIL_CACHE = new Map<string, string>();

/** Extract a static JPEG from a WebP's first frame as a flicker-free base layer. */
function useWebpThumbnail(webpSrc: string | undefined): string | null {
  const [thumbnail, setThumbnail] = useState<string | null>(
    () => (webpSrc ? (WEBP_THUMBNAIL_CACHE.get(webpSrc) ?? null) : null)
  );

  useEffect(() => {
    if (!webpSrc) { setThumbnail(null); return; }
    const cached = WEBP_THUMBNAIL_CACHE.get(webpSrc);
    if (cached) { setThumbnail(cached); return; }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        WEBP_THUMBNAIL_CACHE.set(webpSrc, dataUrl);
        setThumbnail(dataUrl);
      } catch {
        // Canvas tainted or decode failed — no thumbnail extracted
      }
    };
    img.src = webpSrc;
    return () => { cancelled = true; img.onload = null; };
  }, [webpSrc]);

  return thumbnail;
}

type UseWebpPreviewArgs = {
  clip: ClipItem;
  index: number;
  importToken: string;
  isVisible: boolean;
  isHovered: boolean;
  videoPreviewMode: boolean;
  isVideoMode: boolean;
  previewWebpPath?: string;
  reportWebpDemand: (
    clipId: string,
    demand: {
      isVisible: boolean;
      order: number;
      priority: boolean;
      job: Omit<SceneWebpJob, "sceneId">;
    } | null
  ) => void;
};

export function useWebpPreview({
  clip,
  index,
  importToken,
  isVisible,
  isHovered,
  videoPreviewMode,
  isVideoMode,
  previewWebpPath,
  reportWebpDemand,
}: UseWebpPreviewArgs) {
  const webpSourcePath = clip.originalPath || clip.src;
  const webpStart = clip.startSec ?? 0;
  const rawWebpEnd = clip.endSec ?? (webpStart + 2);
  const webpEnd = Math.min(rawWebpEnd > webpStart ? rawWebpEnd : webpStart + 2, webpStart + 2.5);

  const hasAnimatedWebp = Boolean(previewWebpPath);
  const displayThumbnailPath = clip.thumbnail || clip.src;

  const webpFileSrc = previewWebpPath
    ? `${convertFileSrc(previewWebpPath)}?v=${importToken}`
    : undefined;
  const webpThumbnail = useWebpThumbnail(webpFileSrc);

  const [thumbnailSrc, setThumbnailSrc] = useState(displayThumbnailPath);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  // Request scene preview assets using viewport and hover priority.
  useEffect(() => {
    // Video-preview mode never generates WebPs — scenes are shown as video clips.
    if (videoPreviewMode || isVideoMode) {
      reportWebpDemand(clip.id, null);
      return;
    }

    if (!webpSourcePath) {
      reportWebpDemand(clip.id, null);
      return;
    }

    if (previewWebpPath) {
      reportWebpDemand(clip.id, null);
      return;
    }

    reportWebpDemand(clip.id, {
      isVisible,
      order: index,
      priority: isHovered,
      job: {
        sourcePath: webpSourcePath,
        start: webpStart,
        end: webpEnd,
        fps: 8,
        kind: "animated",
      },
    });
  }, [
    clip.id,
    index,
    isHovered,
    isVideoMode,
    videoPreviewMode,
    isVisible,
    previewWebpPath,
    reportWebpDemand,
    webpEnd,
    webpSourcePath,
    webpStart,
  ]);

  // Keep thumbnail rendering resilient: reset load state when source changes.
  useEffect(() => {
    setThumbnailSrc(displayThumbnailPath);
    setThumbnailLoaded(false);
    setThumbnailFailed(false);
  }, [displayThumbnailPath, importToken]);

  // When a WebP becomes available, clear a prior thumbnailFailed so the img
  // can retry using the WebP path instead of the original clip thumbnail.
  useEffect(() => {
    if (previewWebpPath) setThumbnailFailed(false);
  }, [previewWebpPath]);

  const handleThumbnailError = useCallback(() => {
    const fallbackCandidates = [clip.thumbnail, clip.src]
      .filter((value): value is string => Boolean(value));
    const next = fallbackCandidates.find((candidate) => candidate !== thumbnailSrc);
    if (next) {
      setThumbnailSrc(next);
      setThumbnailLoaded(false);
      return;
    }
    setThumbnailFailed(true);
  }, [clip.src, clip.thumbnail, thumbnailSrc]);

  return {
    displayThumbnailPath,
    hasAnimatedWebp,
    webpThumbnail,
    thumbnailSrc,
    thumbnailLoaded,
    setThumbnailLoaded,
    thumbnailFailed,
    handleThumbnailError,
  };
}
