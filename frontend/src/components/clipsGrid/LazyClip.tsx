/**
 * LazyClip.tsx
 *
 * Represents a single video tile in the grid. Handles lazy loading, hover preview, proxy logic, and staggered mounting.
 * Optimized for performance and compatibility (HEVC/H.264 proxying).
 */
import { memo, useState, useRef, useEffect, useCallback } from "react"
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { LazyClipProps } from "./types.ts"
import { DownloadButton } from "./DownloadButton.tsx";
import { useWebpPreview } from "./useWebpPreview.ts";
import { FaCheck, FaPlus } from "react-icons/fa";
import { useAppStateStore } from "../../stores/appStore.ts";
import { useUIStateStore } from "../../stores/UIStore.ts";
import { useGeneralSettingsStore, useThemeSettingsStore } from "../../stores/settingsStore.ts";
import { useScenePreviewStore } from "../../stores/scenePreviewStore.ts";
import { cancelIdle, scheduleIdle } from "../../utils/idle.ts";

const DOWNLOAD_TONE_SAMPLE_SIZE = 24;
const DOWNLOAD_TONE_SOURCE_SIZE = 34;
const DOWNLOAD_TONE_SAMPLE_MARGIN = 6;
const DOWNLOAD_TONE_THRESHOLD = 158;

function formatClipTime(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || isNaN(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const LazyClip = memo(function LazyClip({
  clip,
  index,
  videoPreviewMode,
  requestProxySequential,
  reportProxyDemand,
  reportWebpDemand,
  onClipClick,
  onClipDoubleClick,
  onToggleSelection,
  reportStaggerDemand,
  onDownloadClip,
}: LazyClipProps) {
  const importToken = useAppStateStore(s => s.importToken);

  // Each tile reads only its own animated-WebP path. Subscribing per-tile (rather
  // than threading it down from ClipsContainer) means a new WebP result re-renders
  // just this tile, not the whole grid — critical for smooth scrolling.
  const previewWebpPath = useScenePreviewStore(s => s.animatedByClipId[clip.id]);

  const isSelected = useAppStateStore(s => s.selectedClips.has(clip.id));
  const isFocused = useAppStateStore(s => s.focusedClipId === clip.id);
  const gridPreview = useUIStateStore(s => s.gridPreview);
  const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
  const userHasHEVC = useAppStateStore(s => s.userHasHEVC);
  const audioPlaybackHover = useGeneralSettingsStore(s => s.audioPlaybackHover);
  const previewAudioStreamIndex = useGeneralSettingsStore(s => s.previewAudioStreamIndex);
  const selectedMappedAudioStreamIndex =
    previewAudioStreamIndex !== null && previewAudioStreamIndex > 0
      ? previewAudioStreamIndex
      : null;
  const playbackVolume = useGeneralSettingsStore(s => s.playbackVolume);
  const gridPreviewSpeed = useThemeSettingsStore(s => s.gridPreviewSpeed ?? 1);
  const showDownloadButton = useThemeSettingsStore(s => s.showDownloadButton);
  const showClipTimestamps = useThemeSettingsStore(s => s.showClipTimestamps);

  // ============================ SHARED tile state ============================
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const thumbnailRef = useRef<HTMLImageElement | null>(null);
  const [downloadTone, setDownloadTone] = useState<"light" | "dark">("light");
  // Tracks a pending idle-scheduled tone sample so we can coalesce/cancel it.
  const downloadToneIdleRef = useRef<number | null>(null);

  const originalPath = clip.src;
  // Video-file import mode: clip has a pre-cut video file on disk.
  const isVideoMode = Boolean(clip.clipPath) && clip.clipMode !== "failed";
  // Is this clip currently being merged or split on the backend?
  const isProcessing = clip.originalName === "Merging..." || clip.originalName === "Splitting...";

  // ========================= VIDEO playback state/refs =======================
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasReportedErrorRef = useRef(false);
  const hasFirstFrameRef = useRef(false);
  const videoFrameCallbackIdRef = useRef<number | null>(null);
  const proxyInFlightRef = useRef(false);
  const mergedPreviewInFlightRef = useRef(false);
  const mergedPreviewFetchedKeyRef = useRef<string | null>(null);

  // staggered mount: only start playback when it's this tile's turn (preview-all
  // lights tiles up top-left → bottom-right instead of all at once).
  const [staggerReady, setStaggerReady] = useState(false);
  const staggerDoneRef = useRef(false);

  // if playback fails, keep showing the thumbnail until proxy is ready
  const [, setForceThumbnail] = useState(false);
  // keep thumbnail visible until video is ready to avoid black screen replacing it
  const [isVideoReady, setIsVideoReady] = useState(false);
  // the actual video source (original or proxy)
  const [effectiveSrc, setEffectiveSrc] = useState(clip.src);
  // video mode: cut clip remuxed to the selected audio track, used on hover so
  // hover audio plays the chosen Preview Language (null = play the default track).
  const [videoAudioProxySrc, setVideoAudioProxySrc] = useState<string | null>(null);
  const [, setMergedPreviewSrc] = useState<string | null>(null);
  const [, setMergedPreviewFailed] = useState(false);
  const mergedSrcsKey = clip.mergedSrcs
    ? `${clip.mergedSrcs.join("|")}::audio:${previewAudioStreamIndex ?? "default"}`
    : null;
  // determine if we need a proxy:
  const needsHevcProxy = videoIsHEVC === true && userHasHEVC === false;

  // In video mode, clip files are pre-cut H.264 — mount video element when visible/hovered.
  // In WebP mode, video playback is disabled; hover/preview-all use animated WebP instead.
  const showVideo = isVideoMode;
  const shouldMountVideo = isVideoMode && (isVisible || isHovered);
  const shouldShowThumbnail = isVideoMode ? false : (!showVideo || !shouldMountVideo || !isVideoReady);

  // In video-preview mode, a tile whose clip hasn't been cut yet (and hasn't
  // failed) shows a skeleton until its video arrives via the clip_ready stream.
  const videoClipPending = videoPreviewMode && !isVideoMode && clip.clipMode !== "failed";

  // ============================ WEBP preview state ===========================
  // All thumbnail/animated-WebP state and demand reporting lives in this hook.
  const webp = useWebpPreview({
    clip,
    index,
    importToken,
    isVisible,
    isHovered,
    videoPreviewMode,
    isVideoMode,
    previewWebpPath,
    reportWebpDemand,
  });
  // Show animated WebP on hover, or always when preview-all is enabled.
  const shouldShowWebpOverlay = webp.hasAnimatedWebp && (isHovered || gridPreview);

  // when Preview-all is enabled and we need an HEVC proxy, register demand only while visible.
  useEffect(() => {
    if (isVideoMode) {
      reportProxyDemand(originalPath, null);
      return;
    }

    if (!gridPreview) {
      reportProxyDemand(originalPath, null);
      return;
    }

    const wantsProxyNow =
      needsHevcProxy &&
      isVisible &&
      effectiveSrc === originalPath; // still on original => proxy not yet applied

    if (wantsProxyNow) {
      reportProxyDemand(originalPath, { order: index, priority: isHovered });
    } else {
      reportProxyDemand(originalPath, null);
    }
  }, [gridPreview, isVideoMode, needsHevcProxy, isVisible, effectiveSrc, originalPath, index, isHovered, reportProxyDemand]);

  // reset state when clip/import/audio-stream changes
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.muted = true;
      try {
        v.currentTime = 0;
      } catch {
        // ignore
      }
    }

    hasReportedErrorRef.current = false;
    hasFirstFrameRef.current = false;
    proxyInFlightRef.current = false;
    mergedPreviewInFlightRef.current = false;
    mergedPreviewFetchedKeyRef.current = null;
    setMergedPreviewSrc(null);
    setMergedPreviewFailed(false);

    const callbackVideo = videoRef.current;
    if (callbackVideo && videoFrameCallbackIdRef.current && (callbackVideo as any).cancelVideoFrameCallback) {
      try {
        (callbackVideo as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
      } catch {
        // ignore
      }
    }
    videoFrameCallbackIdRef.current = null;
    staggerDoneRef.current = false;
    setStaggerReady(false);
    setForceThumbnail(false);
    setIsVideoReady(false);
    setEffectiveSrc(clip.src);
    setVideoAudioProxySrc(null);
  }, [clip.src, importToken, previewAudioStreamIndex]);

  // Video mode: when a non-default Preview Language is selected and the user
  // hovers with audio enabled, remux the cut clip to that audio track (video
  // copied — fast) and play it so hover audio is in the chosen language.
  useEffect(() => {
    if (!isVideoMode || !clip.clipPath) return;
    if (selectedMappedAudioStreamIndex === null) return;
    if (!isHovered || !audioPlaybackHover) return;
    if (videoAudioProxySrc) return;

    let cancelled = false;
    invoke<string>("ensure_preview_proxy", {
      clipPath: clip.clipPath,
      audioStreamIndex: selectedMappedAudioStreamIndex,
      transcodeVideo: false,
    })
      .then((path) => { if (!cancelled && path) setVideoAudioProxySrc(path); })
      .catch((err) => { console.warn("video language proxy failed", err); });
    return () => { cancelled = true; };
  }, [isVideoMode, clip.clipPath, selectedMappedAudioStreamIndex, isHovered, audioPlaybackHover, videoAudioProxySrc]);

  const ensurePreviewProxyPath = useCallback(
    async (clipPath: string, priority: boolean, transcodeVideo: boolean): Promise<string> => {
      if (selectedMappedAudioStreamIndex === null) {
        return gridPreview
          ? requestProxySequential(clipPath, priority)
          : invoke<string>("ensure_preview_proxy", { clipPath, transcodeVideo });
      }

      return invoke<string>("ensure_preview_proxy", {
        clipPath,
        transcodeVideo,
        audioStreamIndex: selectedMappedAudioStreamIndex,
      });
    },
    [gridPreview, requestProxySequential, selectedMappedAudioStreamIndex]
  );

  // Proactive HEVC/audio-stream proxy gating:
  // - HEVC without support always needs proxy.
  // - Hover audio with a non-default stream needs a mapped proxy.
  useEffect(() => {
    if (isVideoMode) return; // clip files are pre-cut H.264, never need proxy

    const needsAudioMappedProxy =
      selectedMappedAudioStreamIndex !== null &&
      isHovered &&
      audioPlaybackHover;
    const shouldTranscodeVideo = needsHevcProxy;
    const needsPreviewProxy = shouldTranscodeVideo || needsAudioMappedProxy;

    if (!needsPreviewProxy) return;
    if (!isVisible) return;
    if (!showVideo) return;

    const clipPath = originalPath;
    if (!clipPath || clipPath === "") return;

    const run = async () => {
      try {
        if (proxyInFlightRef.current) return;
        if (effectiveSrc !== originalPath) return; // already proxy

        proxyInFlightRef.current = true;
        setForceThumbnail(true);

        const proxyPath = await ensurePreviewProxyPath(clipPath, /* priority */ isHovered, shouldTranscodeVideo);

        if (originalPath !== clipPath) return;

        if (proxyPath) {
          setEffectiveSrc(proxyPath);
          setForceThumbnail(false);

          setTimeout(() => {
            const vid = videoRef.current;
            if (!vid) return;
            vid.load();
            vid.play().catch(() => { });
          }, 0);
        } else {
          setForceThumbnail(true);
        }
      } catch (err) {
        console.warn("ensure_preview_proxy failed", err);
        setForceThumbnail(true);
      } finally {
        proxyInFlightRef.current = false;
      }
    };

    void run();
  }, [
    isVideoMode,
    needsHevcProxy,
    selectedMappedAudioStreamIndex,
    audioPlaybackHover,
    isVisible,
    isHovered,
    showVideo,
    effectiveSrc,
    originalPath,
    ensurePreviewProxyPath,
  ]);

  // Generate a stream-copy concat preview for merged clips (skipped for HEVC — proxy handles that).
  useEffect(() => {
    if (!mergedSrcsKey || !clip.mergedSrcs) return;
    if (needsHevcProxy) return;
    if (!isVisible) return;
    if (mergedPreviewFetchedKeyRef.current === mergedSrcsKey) return;
    if (mergedPreviewInFlightRef.current) return;

    mergedPreviewFetchedKeyRef.current = mergedSrcsKey;
    mergedPreviewInFlightRef.current = true;
    setMergedPreviewFailed(false);

    invoke<string>("ensure_merged_preview", {
      srcs: clip.mergedSrcs,
      audioStreamIndex: previewAudioStreamIndex ?? undefined,
    })
      .then((path) => {
        if (!path) {
          setMergedPreviewFailed(true);
          return;
        }
        setMergedPreviewSrc(path);
        setEffectiveSrc(path);
      })
      .catch((err) => {
        console.warn("ensure_merged_preview failed", err);
        setMergedPreviewFailed(true);
        mergedPreviewFetchedKeyRef.current = null; // allow retry
      })
      .finally(() => {
        mergedPreviewInFlightRef.current = false;
      });
  }, [mergedSrcsKey, needsHevcProxy, isVisible, clip.mergedSrcs, previewAudioStreamIndex]);

  // Stagger queue: report demand when grid-preview is on and tile is visible.
  // same pattern as the proxy queue - register/unregister, central loop picks
  // the best candidate and calls onReady.  Hover bypasses the queue.
  useEffect(() => {
    if (!gridPreview) {
      reportStaggerDemand(clip.id, null);
      return;
    }

    // hover bypasses the stagger queue - instant playback for the hovered tile.
    if (isHovered) {
      staggerDoneRef.current = true;
      setStaggerReady(true);
      reportStaggerDemand(clip.id, null);
      return;
    }

    // tile scrolled out - reset and unregister.
    if (!isVisible) {
      staggerDoneRef.current = false;
      setStaggerReady(false);
      reportStaggerDemand(clip.id, null);
      return;
    }

    // already stagger-mounted and still visible; don't re-queue.
    if (staggerDoneRef.current) {
      setStaggerReady(true);
      reportStaggerDemand(clip.id, null);
      return;
    }

    // HEVC proxy clips are already serialised by the proxy queue.
    if (needsHevcProxy) {
      setStaggerReady(true);
      reportStaggerDemand(clip.id, null);
      return;
    }

    // register demand - the central queue will call onReady when it's our turn.
    reportStaggerDemand(clip.id, {
      order: index,
      onReady: () => {
        staggerDoneRef.current = true;
        setStaggerReady(true);
      },
    });

    return () => {
      reportStaggerDemand(clip.id, null);
    };
  }, [gridPreview, isHovered, isVisible, needsHevcProxy, clip.id, index, reportStaggerDemand]);

  const requestFirstFrame = useCallback((video: HTMLVideoElement) => {
    if (hasFirstFrameRef.current) return;
    if (!(video as any).requestVideoFrameCallback) return;
    if (videoFrameCallbackIdRef.current) return;

    try {
      videoFrameCallbackIdRef.current = (video as any).requestVideoFrameCallback(() => {
        hasFirstFrameRef.current = true;
        videoFrameCallbackIdRef.current = null;
        setIsVideoReady(true);
      });
    } catch {
      // ignore
    }
  }, []);

  // If we swap sources (e.g., original -> proxy), allow the next onError to run
  // and re-arm thumbnail gating.
  useEffect(() => {
    hasReportedErrorRef.current = false;
    hasFirstFrameRef.current = false;
    setIsVideoReady(false);
  }, [effectiveSrc]);

  // only mark tile as visible when it's near the viewport
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "180px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Playback control:
  // - When hovered (or grid preview mode) AND the video is mounted, ensure it loads and plays.
  // - When not hovered, pause and rewind to 0 so hover-preview always starts at the beginning.
  // We intentionally keep this separate from the proxy queue; it applies to all non-proxy playback too.

  // Control playback: play when hovered/preview, pause and rewind otherwise
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Video mode: always mounted when visible (for the first-frame poster), but
    // only plays on hover, or in preview-all once the stagger queue reaches this
    // tile — so preview-all lights up top-left → bottom-right, not all at once.
    const shouldPlay = isVideoMode
      ? (isHovered || (gridPreview && staggerReady))
      : (showVideo && shouldMountVideo);
    if (shouldPlay) {
      // Audio logic: only play audio if hovered AND setting is enabled.
      // Grid preview (Preview-all) should remain muted unless specifically hovered.
      const audioEnabled = isHovered && audioPlaybackHover;
      v.muted = !audioEnabled;
      v.volume = playbackVolume;

      v.autoplay = true;
      v.loop = true;
      v.playbackRate = Math.max(0.25, Math.min(3, gridPreviewSpeed));

      if (v.readyState === 0) {
        try {
          v.load();
        } catch {
          // ignore
        }
      }
      v.play().catch(() => { });
    } else {
      v.pause();
      v.muted = true;
      try {
        v.currentTime = 0;
      } catch {
        // ignore
      }
    }
  }, [isVideoMode, gridPreview, staggerReady, showVideo, shouldMountVideo, effectiveSrc, isHovered, audioPlaybackHover, playbackVolume, gridPreviewSpeed]);

  // Some HEVC variants (e.g. yuv444p10) can appear "supported" but stall/black-screen in HTML video.
  // If no frame becomes ready shortly after playback starts, force a proxy fallback.
  useEffect(() => {
    if (isVideoMode) return; // clip files are pre-cut H.264, never need HEVC fallback
    if (!showVideo || !shouldMountVideo) return;
    if (videoIsHEVC !== true) return;
    if (effectiveSrc !== originalPath) return;

    const timeout = window.setTimeout(async () => {
      const v = videoRef.current;
      if (!v) return;
      if (proxyInFlightRef.current) return;
      if (effectiveSrc !== originalPath) return;

      if (hasFirstFrameRef.current || v.readyState >= 2) {
        return;
      }

      try {
        proxyInFlightRef.current = true;
        setForceThumbnail(true);

        const proxyPath = await ensurePreviewProxyPath(originalPath, isHovered, true);

        if (!proxyPath) return;

        setEffectiveSrc(proxyPath);
        setForceThumbnail(false);

        setTimeout(() => {
          const vid = videoRef.current;
          if (!vid) return;
          vid.load();
          vid.play().catch(() => { });
        }, 0);
      } catch {
        setForceThumbnail(true);
      } finally {
        proxyInFlightRef.current = false;
      }
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    isVideoMode,
    showVideo,
    shouldMountVideo,
    videoIsHEVC,
    effectiveSrc,
    originalPath,
    gridPreview,
    isHovered,
    requestProxySequential,
    ensurePreviewProxyPath,
  ]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (clip.thumbnailReady === false) return; // still generating — block
      onClipClick(clip.id, clip.src, index, e);
    },
    [clip.id, clip.src, clip.thumbnailReady, index, onClipClick]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (clip.thumbnailReady === false) return; // still generating — block
      onClipDoubleClick(clip.id, clip.src, index, e);
    },
    [clip.id, clip.src, clip.thumbnailReady, index, onClipDoubleClick]
  );


  // Register video element ref for parent access
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
  }, []);

  const updateDownloadToneFromThumbnail = useCallback((img: HTMLImageElement | null) => {
    if (!img || img.naturalWidth === 0 || img.naturalHeight === 0) return;

    // getImageData forces a synchronous decode + pixel readback; defer it to idle
    // time (coalescing any prior pending sample) so it never lands on a scroll
    // frame. Re-check the image inside the callback in case the tile changed.
    if (downloadToneIdleRef.current !== null) {
      cancelIdle(downloadToneIdleRef.current);
    }
    downloadToneIdleRef.current = scheduleIdle(() => {
      downloadToneIdleRef.current = null;
      if (!img || img.naturalWidth === 0 || img.naturalHeight === 0) return;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        // Sample the icon zone (top-right) to choose dark/light icon color.
        const targetSize = DOWNLOAD_TONE_SAMPLE_SIZE;
        const sourceW = Math.min(DOWNLOAD_TONE_SOURCE_SIZE, img.naturalWidth);
        const sourceH = Math.min(DOWNLOAD_TONE_SOURCE_SIZE, img.naturalHeight);
        const margin = DOWNLOAD_TONE_SAMPLE_MARGIN;

        const sx = Math.max(0, img.naturalWidth - sourceW - margin);
        const sy = Math.max(0, margin);

        canvas.width = targetSize;
        canvas.height = targetSize;

        ctx.drawImage(
          img,
          sx,
          sy,
          sourceW,
          sourceH,
          0,
          0,
          targetSize,
          targetSize
        );

        const data = ctx.getImageData(0, 0, targetSize, targetSize).data;
        let luminanceSum = 0;
        let alphaSum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3] / 255;
          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          luminanceSum += luminance * a;
          alphaSum += a;
        }

        const avgLuminance = alphaSum > 0 ? luminanceSum / alphaSum : 128;
        setDownloadTone(avgLuminance >= DOWNLOAD_TONE_THRESHOLD ? "dark" : "light");
      } catch {
        // Keep previous tone if sampling fails.
      }
    });
  }, []);

  // Cancel any pending tone sample when the tile unmounts.
  useEffect(() => {
    return () => {
      if (downloadToneIdleRef.current !== null) cancelIdle(downloadToneIdleRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showDownloadButton) return;
    const img = thumbnailRef.current;
    if (!img) return;
    if (!img.complete) return;
    updateDownloadToneFromThumbnail(img);
  }, [webp.displayThumbnailPath, importToken, showDownloadButton, updateDownloadToneFromThumbnail]);

  const showTileLoadingOverlay = isVideoMode
    ? !isVideoReady
    : (clip.thumbnailReady === false || !webp.thumbnailLoaded || webp.thumbnailFailed);

  return (
    <div
      ref={wrapperRef}
      className={`clip-wrapper ${isFocused ? "focused" : ""} ${isSelected ? "selected" : ""}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      // hover toggles isHovered, which controls whether the <video> mounts and whether playback starts.
      onMouseEnter={() => {
        // IntersectionObserver can lag by a tick; hovering should always mount/play immediately.
        setIsVisible(true);
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        // Clear transient error/thumbnail flags so a later hover can try again.
        hasReportedErrorRef.current = false;
        setForceThumbnail(false);
        setIsVideoReady(false);
      }}
    >
      <button
        className={`clip-selected ${isSelected ? "active" : ""}`}
        onClick={(e) => onToggleSelection(clip.id, e)}
        title={isSelected ? "Deselect clip" : "Select clip"}
      >
        {isSelected ? <FaCheck /> : <FaPlus />}
      </button>

      {isVisible ? (
        videoClipPending ? (
          <div className="clip clip-skeleton" style={{ borderRadius: 15 }} />
        ) : (
        <>
          {/* ===================== WEBP layer: static thumbnail =====================
              Rendered in WebP mode only; video mode uses the <video> for the poster. */}
          {!isVideoMode && !webp.thumbnailFailed && clip.thumbnailReady !== false && (
            <img
              ref={thumbnailRef}
              className="clip"
              src={
                webp.webpThumbnail
                ?? (webp.hasAnimatedWebp
                  ? `${convertFileSrc(previewWebpPath!)}?v=${importToken}`
                  : `${convertFileSrc(webp.thumbnailSrc)}?v=${importToken}`)
              }
              style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
              draggable={false}
              onLoad={(e) => {
                webp.setThumbnailLoaded(true);
                if (showDownloadButton) {
                  updateDownloadToneFromThumbnail(e.currentTarget);
                }
              }}
              onError={webp.handleThumbnailError}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          )}

          {/* SHARED layer: skeleton shown until the thumbnail/video is ready */}
          {showTileLoadingOverlay && (
            <div
              className="clip clip-skeleton clip-thumb-loading-overlay"
              style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
            />
          )}
          {/* ===================== VIDEO layer: cut clip playback =====================
              In video mode: mounted when visible/hovered to show the first frame.
              In WebP mode: intentionally disabled (showVideo=false → shouldMountVideo=false). */}
          {shouldMountVideo && (
            <video
              className="clip"
              src={`${isVideoMode
                ? convertFileSrc(videoAudioProxySrc ?? clip.clipPath!)
                : convertFileSrc(effectiveSrc)}?v=${importToken}`}
              muted={!(isHovered && audioPlaybackHover)}
              loop
              autoPlay
              playsInline
              preload="none"
              ref={setVideoRef}
              style={{ position: "absolute", inset: 0 }}
              draggable={false}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onLoadedMetadata={(e) => {
                if (gridPreview || isHovered) {
                  const audioEnabled = isHovered && audioPlaybackHover;
                  e.currentTarget.muted = !audioEnabled;
                  e.currentTarget.volume = playbackVolume;
                  e.currentTarget.play().catch(() => { });
                }
              }}
              onPlaying={(e) => {
                requestFirstFrame(e.currentTarget);
              }}
              onLoadedData={() => {
                hasFirstFrameRef.current = true;
                setIsVideoReady(true);
              }}
              onError={(e) => {
                if (hasReportedErrorRef.current) return;
                hasReportedErrorRef.current = true;

                if (effectiveSrc !== originalPath) {
                  setForceThumbnail(true);
                  return;
                }

                setForceThumbnail(true);

                const v = e.currentTarget;
                const errorCode = v.error?.code ?? null;
                if (import.meta.env.DEV) console.log(`Error on video -> CODE: ${errorCode}`);

                invoke("hover_preview_error", {
                  clipId: clip.id,
                  clipPath: originalPath,
                  errorCode,
                }).catch(() => { });

                if (proxyInFlightRef.current) return;
                proxyInFlightRef.current = true;

                const clipPath = originalPath;
                (async () => {
                  try {
                    const proxyPath = await ensurePreviewProxyPath(clipPath, true, true);

                    if (originalPath !== clipPath) return;
                    if (!proxyPath) {
                      setForceThumbnail(true);
                      return;
                    }

                    setEffectiveSrc(proxyPath);
                    setForceThumbnail(false);

                    setTimeout(() => {
                      const vid = videoRef.current;
                      if (!vid) return;

                      const audioEnabled = isHovered && audioPlaybackHover;
                      vid.muted = !audioEnabled;
                      vid.volume = playbackVolume;

                      vid.load();
                      vid.play().catch(() => { });
                    }, 0);
                  } catch {
                    setForceThumbnail(true);
                  } finally {
                    proxyInFlightRef.current = false;
                  }
                })();
              }}
            />
          )}

          {/* WEBP layer: animated preview, shown over the static thumbnail on hover/preview-all */}
          {shouldShowWebpOverlay && previewWebpPath && (
            <img
              className="clip"
              style={{ position: "absolute", inset: 0, objectFit: "cover", zIndex: 3 }}
              src={`${convertFileSrc(previewWebpPath)}?v=${importToken}`}
              draggable={false}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
            />
          )}

          {/* SHARED layer: status / timestamp / download chrome */}
          {isProcessing && (
            <div className="clip-status-overlay">
              <span className="status-text">{clip.originalName}</span>
            </div>
          )}

          {showClipTimestamps && clip.startSec !== undefined && (
            <div className="clip-original-timestamp">
              {formatClipTime(clip.startSec)}
            </div>
          )}

          {showDownloadButton && (
            <DownloadButton tone={downloadTone} onClick={() => onDownloadClip(clip)} />
          )}
        </>
        )
      ) : (
        <div className="clip clip-skeleton" style={{ borderRadius: 15 }} />
      )}
    </div>
  );
});
