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
import { FaCheck, FaPlus } from "react-icons/fa";
import { useAppStateStore } from "../../stores/appStore.ts";
import { useUIStateStore } from "../../stores/UIStore.ts";
import { useGeneralSettingsStore, useThemeSettingsStore } from "../../stores/settingsStore.ts";

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
  previewWebpPath,
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

  const isSelected = useAppStateStore(s => s.selectedClips.has(clip.id));
  const isFocused = useAppStateStore(s => s.focusedClipId === clip.id);
  const gridPreview = useUIStateStore(s => s.gridPreview);
  const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
  const userHasHEVC = useAppStateStore(s => s.userHasHEVC);
  const importMethod = useGeneralSettingsStore(s => s.importMethod);
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

  // state and refs for tile visibility, hover, video element, and proxy state
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const thumbnailRef = useRef<HTMLImageElement | null>(null);
  const hasReportedErrorRef = useRef(false);
  const hasFirstFrameRef = useRef(false);
  const videoFrameCallbackIdRef = useRef<number | null>(null);
  const proxyInFlightRef = useRef(false);
  const mergedPreviewInFlightRef = useRef(false);
  const mergedPreviewFetchedKeyRef = useRef<string | null>(null);

  // staggered mount: only mount video when it's this tile's turn
  const [, setStaggerReady] = useState(false);
  const staggerDoneRef = useRef(false);

  // if playback fails, keep showing the thumbnail until proxy is ready
  const [, setForceThumbnail] = useState(false);
  // keep thumbnail visible until video is ready to avoid black screen replacing it
  const [isVideoReady, setIsVideoReady] = useState(false);
  // the actual video source (original or proxy)
  const [effectiveSrc, setEffectiveSrc] = useState(clip.src);
  const [, setMergedPreviewSrc] = useState<string | null>(null);
  const [, setMergedPreviewFailed] = useState(false);
  const mergedSrcsKey = clip.mergedSrcs
    ? `${clip.mergedSrcs.join("|")}::audio:${previewAudioStreamIndex ?? "default"}`
    : null;
  const originalPath = clip.src;
  const webpSourcePath = clip.originalPath || clip.src;
  const webpStart =
    typeof clip.startSec === "number"
      ? clip.startSec
      : typeof clip.start === "number"
        ? clip.start
        : 0;
  const rawWebpEnd =
    typeof clip.endSec === "number"
      ? clip.endSec
      : typeof clip.end === "number"
        ? clip.end
        : webpStart + 2;
  const normalizedWebpEnd = rawWebpEnd > webpStart ? rawWebpEnd : webpStart + 2;
  const webpEnd = Math.min(normalizedWebpEnd, webpStart + 2.5);
  const hasAnimatedWebp = Boolean(previewWebpPath);
  const webpImportMode = importMethod === "webp_files";
  const previewAllEnabled = webpImportMode || gridPreview;
  // Animation is controlled ONLY by Preview-all. At rest we show the static first-frame poster.
  const shouldAnimateWebp = hasAnimatedWebp && previewAllEnabled;
  const displayThumbnailPath = shouldAnimateWebp
    ? (previewWebpPath as string)
    : (clip.thumbnail || clip.src);

  // Is this clip currently being merged or split on the backend?
  const isProcessing = clip.originalName === "Merging..." || clip.originalName === "Splitting...";

  const [downloadTone, setDownloadTone] = useState<"light" | "dark">("light");
  const [thumbnailSrc, setThumbnailSrc] = useState(displayThumbnailPath);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  // determine if we need a proxy:
  const needsHevcProxy = videoIsHEVC === true && userHasHEVC === false;

  // Video playback is intentionally disabled for now; hover/focus/preview-all use animated WebP.
  const showVideo = false;
  const shouldMountVideo = false;
  const shouldShowThumbnail = !showVideo || !shouldMountVideo || !isVideoReady;

  // when Preview-all is enabled and we need an HEVC proxy, register demand only while visible.
  useEffect(() => {
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
  }, [gridPreview, needsHevcProxy, isVisible, effectiveSrc, originalPath, index, isHovered, reportProxyDemand]);

  // Request scene preview assets using viewport and hover priority.
  useEffect(() => {
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
    isVisible,
    previewWebpPath,
    reportWebpDemand,
    webpEnd,
    webpSourcePath,
    webpStart,
  ]);


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
  }, [clip.src, importToken, previewAudioStreamIndex]);

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
    needsHevcProxy,
    selectedMappedAudioStreamIndex,
    audioPlaybackHover,
    isVisible,
    isHovered,
    showVideo,
    effectiveSrc,
    originalPath,
    ensurePreviewProxyPath,
    needsHevcProxy,
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

  // Keep thumbnail rendering resilient: reset load state when source changes.
  useEffect(() => {
    setThumbnailSrc(displayThumbnailPath);
    setThumbnailLoaded(false);
    setThumbnailFailed(false);
  }, [displayThumbnailPath, importToken]);


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

    const shouldPlay = showVideo && shouldMountVideo;
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
  }, [showVideo, shouldMountVideo, effectiveSrc, isHovered, audioPlaybackHover, playbackVolume, gridPreviewSpeed]);

  // Some HEVC variants (e.g. yuv444p10) can appear "supported" but stall/black-screen in HTML video.
  // If no frame becomes ready shortly after playback starts, force a proxy fallback.
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!showDownloadButton) return;
    const img = thumbnailRef.current;
    if (!img) return;
    if (!img.complete) return;
    updateDownloadToneFromThumbnail(img);
  }, [displayThumbnailPath, importToken, showDownloadButton, updateDownloadToneFromThumbnail]);

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

  const showTileLoadingOverlay = clip.thumbnailReady === false || !thumbnailLoaded || thumbnailFailed;

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
        <>
          {/* Thumbnail — always rendered when visible, hidden on hover */}
          {!thumbnailFailed && clip.thumbnailReady !== false && (
            <img
              ref={thumbnailRef}
              className="clip"
              src={`${convertFileSrc(thumbnailSrc)}?v=${importToken}`}
              style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
              draggable={false}
              onLoad={(e) => {
                setThumbnailLoaded(true);
                if (showDownloadButton) {
                  updateDownloadToneFromThumbnail(e.currentTarget);
                }
              }}
              onError={handleThumbnailError}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          )}

          {showTileLoadingOverlay && (
            <div
              className="clip clip-skeleton clip-thumb-loading-overlay"
              style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
            />
          )}
          {/* Video - only mounted when hovered or gridPreview, otherwise skip the DOM node entirely */}
          {shouldMountVideo && (
            <video
              className="clip"
              src={`${convertFileSrc(effectiveSrc)}?v=${importToken}`}
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

          {/* Status Overlays */}
          {isProcessing && (
            <div className="clip-status-overlay">
              <span className="status-text">{clip.originalName}</span>
            </div>
          )}
          {/* {!isProcessing && forceThumbnail && needsHevcProxy && (
            <div className="clip-status-overlay">
              <span className="status-text">Processing...</span>
            </div>
          )} */}

          {showClipTimestamps && (clip.startSec ?? clip.start) !== undefined && (
            <div className="clip-original-timestamp">
              {formatClipTime(clip.startSec ?? clip.start)}
            </div>
          )}

          {showDownloadButton && (
            <DownloadButton tone={downloadTone} onClick={() => onDownloadClip(clip)} />
          )}
        </>
      ) : (
        <div className="clip clip-skeleton" style={{ borderRadius: 15 }} />
      )}
    </div>
  );
});
