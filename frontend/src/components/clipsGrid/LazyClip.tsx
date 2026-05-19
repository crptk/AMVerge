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
  requestProxySequential,
  reportProxyDemand,
  onClipClick,
  onClipDoubleClick,
  onToggleSelection,
  reportStaggerDemand,
  onDownloadClip,
}: LazyClipProps) {
  const importToken = useAppStateStore(s => s.importToken);

  const isSelected = useAppStateStore(s => s.selectedClips.has(clip.id));
  const isFocused = useAppStateStore(s => s.focusedClip === clip.src);
  const gridPreview = useUIStateStore(s => s.gridPreview);
  const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
  const userHasHEVC = useAppStateStore(s => s.userHasHEVC);
  const audioPlaybackHover = useGeneralSettingsStore(s => s.audioPlaybackHover);
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
  const [staggerReady, setStaggerReady] = useState(false);
  const staggerDoneRef = useRef(false);

  // if playback fails, keep showing the thumbnail until proxy is ready
  const [forceThumbnail, setForceThumbnail] = useState(false);
  // keep thumbnail visible until video is ready to avoid black screen replacing it
  const [isVideoReady, setIsVideoReady] = useState(false);
  // the actual video source (original or proxy)
  const [effectiveSrc, setEffectiveSrc] = useState(clip.src);
  const mergedSrcsKey = clip.mergedSrcs ? clip.mergedSrcs.join("|") : null;
  const originalPath = clip.src;

  // Is this clip currently being merged or split on the backend?
  const isProcessing = clip.originalName === "Merging..." || clip.originalName === "Splitting...";

  const [downloadTone, setDownloadTone] = useState<"light" | "dark">("light");

  // determine if we need a proxy:
  const needsHevcProxy = videoIsHEVC === true && userHasHEVC === false;
  const waitingForCodecInfo = videoIsHEVC === null && userHasHEVC === false;

  // only show video if hovered or grid preview is on
  const showVideo = isHovered || gridPreview;
  // wait for proxy if needed
  const waitingForRequiredProxy = needsHevcProxy && effectiveSrc === clip.src;
  // only mount video if allowed by stagger queue or hover
  const staggerGate = !gridPreview || isHovered || staggerReady;
  const shouldMountVideo =
    showVideo && !forceThumbnail && !waitingForRequiredProxy && !waitingForCodecInfo && staggerGate;
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


  // reset state when clip or import changes
  useEffect(() => {
    hasReportedErrorRef.current = false;
    hasFirstFrameRef.current = false;
    proxyInFlightRef.current = false;
    mergedPreviewInFlightRef.current = false;
    mergedPreviewFetchedKeyRef.current = null;

    const v = videoRef.current;
    if (v && videoFrameCallbackIdRef.current && (v as any).cancelVideoFrameCallback) {
      try {
        (v as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
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
  }, [clip.src, importToken]);

  // Proactive HEVC gating:
  // if HEVC isn't supported, request the proxy as soon as the user hovers (or gridPreview is on),
  // and keep the thumbnail visible until we can swap to the proxy.
  useEffect(() => {
    if (!needsHevcProxy) return;
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

        const proxyPath = gridPreview
          ? await requestProxySequential(clipPath, /* priority */ isHovered)
          : await invoke<string>("ensure_preview_proxy", { clipPath });

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
  }, [needsHevcProxy, isVisible, isHovered, gridPreview, effectiveSrc, originalPath, requestProxySequential]);

  // Generate a stream-copy concat preview for merged clips (skipped for HEVC — proxy handles that).
  useEffect(() => {
    if (!mergedSrcsKey || !clip.mergedSrcs) return;
    if (needsHevcProxy) return;
    if (!isVisible) return;
    if (mergedPreviewFetchedKeyRef.current === mergedSrcsKey) return;
    if (mergedPreviewInFlightRef.current) return;

    mergedPreviewFetchedKeyRef.current = mergedSrcsKey;
    mergedPreviewInFlightRef.current = true;

    invoke<string>("ensure_merged_preview", { srcs: clip.mergedSrcs })
      .then((path) => {
        setEffectiveSrc(path);
      })
      .catch((err) => {
        console.warn("ensure_merged_preview failed", err);
        mergedPreviewFetchedKeyRef.current = null; // allow retry
      })
      .finally(() => {
        mergedPreviewInFlightRef.current = false;
      });
  }, [mergedSrcsKey, needsHevcProxy, isVisible, clip.mergedSrcs]);

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
      { rootMargin: "400px", threshold: 0 }
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

        const proxyPath = gridPreview
          ? await requestProxySequential(originalPath, isHovered)
          : await invoke<string>("ensure_preview_proxy", { clipPath: originalPath });

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
  }, [clip.thumbnail, importToken, showDownloadButton, updateDownloadToneFromThumbnail]);

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
          {clip.thumbnailReady === false ? (
            <div className="clip clip-skeleton" style={{ opacity: shouldShowThumbnail ? 1 : 0 }} />
          ) : (
            <img
              ref={thumbnailRef}
              className="clip"
              src={`${convertFileSrc(clip.thumbnail)}?v=${importToken}`}
              style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
              draggable={false}
              onLoad={(e) => {
                if (showDownloadButton) {
                  updateDownloadToneFromThumbnail(e.currentTarget);
                }
              }}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
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
                    const proxyPath = gridPreview
                      ? await requestProxySequential(clipPath, true)
                      : await invoke<string>("ensure_preview_proxy", { clipPath });

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
