/**
 * LazyClip.tsx
 *
 * Represents a single video tile in the grid. Handles lazy loading, hover preview, proxy logic, and staggered mounting.
 * Optimized for performance and compatibility (HEVC/H.264 proxying).
 */
import { memo, useState, useRef, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LazyClipProps } from "./types.ts"
import { DownloadButton } from "./DownloadButton.tsx";

const DOWNLOAD_TONE_SAMPLE_SIZE = 24;
const DOWNLOAD_TONE_SOURCE_SIZE = 34;
const DOWNLOAD_TONE_SAMPLE_MARGIN = 6;
const DOWNLOAD_TONE_THRESHOLD = 158;

export const LazyClip = memo(function LazyClip({
  clip,
  index,
  importToken,
  isExportSelected,
  isFocused,
  gridPreview,
  requestProxySequential,
  reportProxyDemand,
  onClipClick,
  onClipDoubleClick,
  registerVideoRef,
  reportStaggerDemand,
  videoIsHEVC,
  userHasHEVC,
  generalSettings,
  onDownloadClip,
  themeSettings,
}: LazyClipProps) {
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

  // staggered mount: only mount video when it's this tile's turn
  const [staggerReady, setStaggerReady] = useState(false);
  const staggerDoneRef = useRef(false);

  // if playback fails, keep showing the thumbnail until proxy is ready
  const [forceThumbnail, setForceThumbnail] = useState(false);
  // keep thumbnail visible until video is ready to avoid black screen replacing it
  const [isVideoReady, setIsVideoReady] = useState(false);
  // the actual video source (original or proxy)
  const [effectiveSrc, setEffectiveSrc] = useState(clip.src);
  const [downloadTone, setDownloadTone] = useState<"light" | "dark">("light");

  // determine if we need a proxy (HEVC not supported)
  const needsHevcProxy = videoIsHEVC === true && userHasHEVC.current === false;
  const waitingForCodecInfo = videoIsHEVC === null && userHasHEVC.current === false;

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
  // this allows the parent to re-prioritize work when the user scrolls.
  useEffect(() => {
    if (!gridPreview) {
      reportProxyDemand(clip.src, null);
      return;
    }

    const wantsProxyNow =
      needsHevcProxy &&
      isVisible &&
      effectiveSrc === clip.src; // still on original => proxy not yet applied

    if (wantsProxyNow) {
      reportProxyDemand(clip.src, { order: index, priority: isHovered });
    } else {
      reportProxyDemand(clip.src, null);
    }
  }, [gridPreview, needsHevcProxy, isVisible, effectiveSrc, clip.src, index, isHovered, reportProxyDemand]);


  // reset state when clip or import changes
  useEffect(() => {
    hasReportedErrorRef.current = false;
    hasFirstFrameRef.current = false;
    proxyInFlightRef.current = false;

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

    if (effectiveSrc !== clip.src) return; // already proxy
    if (proxyInFlightRef.current) return;

    proxyInFlightRef.current = true;
    setForceThumbnail(true);
    setIsVideoReady(false);

    const clipPath = clip.src;

    const run = async () => {
      try {
        const proxyPath = gridPreview
          ? await requestProxySequential(clipPath, /* priority */ isHovered)
          : await invoke<string>("ensure_preview_proxy", { clipPath });

        // if this tile has since been rebound to a different clip, ignore the result.
        if (clip.src !== clipPath) return;

        if (!proxyPath) {
          // if we can't generate a proxy, don't mount the (unsupported) HEVC video.
          setForceThumbnail(true);
          return;
        }

        setEffectiveSrc(proxyPath);
        setForceThumbnail(false);

        setTimeout(() => {
          const vid = videoRef.current;
          if (!vid) return;
          vid.load();
          vid.play().catch(() => {});
        }, 0);
      } catch (err) {
        console.warn("ensure_preview_proxy failed", err);
        // stay on the thumbnail; the original HEVC stream is not playable.
        setForceThumbnail(true);
      } finally {
        proxyInFlightRef.current = false;
      }
    };

    void run();
  }, [needsHevcProxy, isVisible, isHovered, gridPreview, effectiveSrc, clip.src, requestProxySequential]);

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
      const audioEnabled = isHovered && generalSettings.audioPlaybackHover;
      v.muted = !audioEnabled;
      v.volume = generalSettings.playbackVolume;

      v.autoplay = true;
      v.loop = true;
      try {
        if (v.readyState === 0) v.load();
      } catch {
        // ignore
      }
      v.play().catch(() => {});
    } else {
      v.pause();
      v.muted = true;
      try {
        v.currentTime = 0;
      } catch {
        // ignore
      }
    }
  }, [showVideo, shouldMountVideo, effectiveSrc, isHovered, generalSettings.audioPlaybackHover, generalSettings.playbackVolume]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onClipClick(clip.id, clip.src, index, e);
    },
    [clip.id, clip.src, index, onClipClick]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onClipDoubleClick(clip.id, clip.src, index, e);
    },
    [clip.id, clip.src, index, onClipDoubleClick]
  );


  // Register video element ref for parent access
  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      registerVideoRef(clip.id, el);
    },
    [clip.id, registerVideoRef]
  );

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
    const img = thumbnailRef.current;
    if (!img) return;
    if (!img.complete) return;
    updateDownloadToneFromThumbnail(img);
  }, [clip.thumbnail, importToken, updateDownloadToneFromThumbnail]);

  return (
    <div
      ref={wrapperRef}
      className={`clip-wrapper ${isFocused ? "focused" : ""}`}
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
      <span className={`clip-export-dot ${isExportSelected ? "ok" : ""}`} />
      {isVisible ? (
        <>
          {/* Thumbnail — always rendered when visible, hidden on hover */}
          <img
            ref={thumbnailRef}
            className="clip"
            src={`${convertFileSrc(clip.thumbnail)}?v=${importToken}`}
            style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
            draggable={false}
            onLoad={(e) => {
              updateDownloadToneFromThumbnail(e.currentTarget);
            }}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
          {/* Video - only mounted when hovered or gridPreview, otherwise skip the DOM node entirely */}
          {shouldMountVideo && (
            <video
              className="clip"
              src={`${convertFileSrc(effectiveSrc)}?v=${importToken}`}
              muted={!(isHovered && generalSettings.audioPlaybackHover)}
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
                  const audioEnabled = isHovered && generalSettings.audioPlaybackHover;
                  e.currentTarget.muted = !audioEnabled;
                  e.currentTarget.volume = generalSettings.playbackVolume;
                  e.currentTarget.play().catch(() => {});
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

                if (effectiveSrc !== clip.src) {
                  setForceThumbnail(true);
                  return;
                }

                setForceThumbnail(true);

                const v = e.currentTarget;
                const errorCode = v.error?.code ?? null;
                if (import.meta.env.DEV) console.log(`Error on video -> CODE: ${errorCode}`);

                invoke("hover_preview_error", {
                  clipId: clip.id,
                  clipPath: clip.src,
                  errorCode,
                }).catch(() => {});

                if (proxyInFlightRef.current) return;
                proxyInFlightRef.current = true;

                const clipPath = clip.src;
                (async () => {
                  try {
                    const proxyPath = gridPreview
                      ? await requestProxySequential(clipPath, true)
                      : await invoke<string>("ensure_preview_proxy", { clipPath });

                    if (clip.src !== clipPath) return;
                    if (!proxyPath) {
                      setForceThumbnail(true);
                      return;
                    }

                    setEffectiveSrc(proxyPath);
                    setForceThumbnail(false);

                    setTimeout(() => {
                      const vid = videoRef.current;
                      if (!vid) return;
                      
                      const audioEnabled = isHovered && generalSettings.audioPlaybackHover;
                      vid.muted = !audioEnabled;
                      vid.volume = generalSettings.playbackVolume;
                      
                      vid.load();
                      vid.play().catch(() => {});
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
          {themeSettings.showDownloadButton && (
            <DownloadButton tone={downloadTone} onClick={() => onDownloadClip(clip)} />
          )}
        </>
      ) : (
        <div className="clip clip-skeleton" style={{ borderRadius: 15 }} />
      )}
    </div>
  );
});
