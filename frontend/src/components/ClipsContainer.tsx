import { memo, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

// --------------------
//     Types/Props
// --------------------

type ClipContainerProps = {
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  cols: number;
  gridPreview: boolean;
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedClips: Set<string>;
  clips: { id: string; src: string; thumbnail: string }[];
  importToken: string;
  loading: boolean;
  isEmpty: boolean;
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
  focusedClip: string | null;
};

// --------------------
// Viewport-Aware Proxy Queue
// --------------------

type DeferredProxy = {
  promise: Promise<string>;
  resolve: (proxyPath: string) => void;
  reject: (err: unknown) => void;
};

type ProxyDemand = {
  order: number; // lower = closer to top
  priority: boolean; // hovered tiles get first dibs
  seq: number; // higher = more recent
};

function useViewportAwareProxyQueue() {
  const proxyCacheRef = useRef<Map<string, string>>(new Map());
  const proxyDeferredRef = useRef<Map<string, DeferredProxy>>(new Map());
  const proxyProcessingRef = useRef(false);

  const proxyDemandRef = useRef<Map<string, ProxyDemand>>(new Map());
  const proxyDemandSeqRef = useRef(0);
  const proxyInFlightClipRef = useRef<string | null>(null);

  const pickNextProxyClip = useCallback((): string | null => {
    let best: { clipPath: string; demand: ProxyDemand } | null = null;

    for (const [clipPath, demand] of proxyDemandRef.current) {
      if (!proxyDeferredRef.current.has(clipPath)) continue;
      if (proxyInFlightClipRef.current === clipPath) continue;

      if (!best) {
        best = { clipPath, demand };
        continue;
      }

      const a = demand;
      const b = best.demand;

      const aPri = a.priority ? 1 : 0;
      const bPri = b.priority ? 1 : 0;
      if (aPri !== bPri) {
        if (aPri > bPri) best = { clipPath, demand };
        continue;
      }

      if (a.order !== b.order) {
        if (a.order < b.order) best = { clipPath, demand };
        continue;
      }

      if (a.seq !== b.seq) {
        if (a.seq > b.seq) best = { clipPath, demand };
      }
    }

    return best?.clipPath ?? null;
  }, []);

  const processProxyQueue = useCallback(async () => {
    if (proxyProcessingRef.current) return;
    proxyProcessingRef.current = true;

    try {
      while (true) {
        const clipPath = pickNextProxyClip();
        if (!clipPath) break;

        // cache hit
        const cached = proxyCacheRef.current.get(clipPath);
        if (cached) {
          const deferred = proxyDeferredRef.current.get(clipPath);
          if (deferred) {
            deferred.resolve(cached);
            proxyDeferredRef.current.delete(clipPath);
          }
          continue;
        }

        const deferred = proxyDeferredRef.current.get(clipPath);
        if (!deferred) continue;

        try {
          proxyInFlightClipRef.current = clipPath;
          const proxyPath = await invoke<string>("ensure_preview_proxy", { clipPath });
          if (!proxyPath) throw new Error("ensure_preview_proxy returned empty path");

          proxyCacheRef.current.set(clipPath, proxyPath);
          deferred.resolve(proxyPath);
        } catch (err) {
          deferred.reject(err);
        } finally {
          if (proxyInFlightClipRef.current === clipPath) proxyInFlightClipRef.current = null;
          proxyDeferredRef.current.delete(clipPath);
        }
      }
    } finally {
      proxyProcessingRef.current = false;
    }
  }, [pickNextProxyClip]);

  const requestProxySequential = useCallback(
    (clipPath: string, priority: boolean) => {
      const cached = proxyCacheRef.current.get(clipPath);
      if (cached) return Promise.resolve(cached);

      const existing = proxyDeferredRef.current.get(clipPath);
      if (existing) return existing.promise;

      let resolve!: (proxyPath: string) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      proxyDeferredRef.current.set(clipPath, { promise, resolve, reject });

      // Accept priority here too so hover can jump ahead even before demand reporting runs.
      const seq = ++proxyDemandSeqRef.current;
      const existingDemand = proxyDemandRef.current.get(clipPath);
      proxyDemandRef.current.set(clipPath, {
        order: existingDemand?.order ?? Number.POSITIVE_INFINITY,
        priority: priority || existingDemand?.priority === true,
        seq,
      });

      void processProxyQueue();
      return promise;
    },
    [processProxyQueue]
  );

  const reportProxyDemand = useCallback(
    (clipPath: string, demand: { order: number; priority: boolean } | null) => {
      if (!demand) {
        proxyDemandRef.current.delete(clipPath);

        // If this was enqueued but scrolled offscreen before processing, cancel it.
        const deferred = proxyDeferredRef.current.get(clipPath);
        if (
          deferred &&
          proxyInFlightClipRef.current !== clipPath &&
          !proxyCacheRef.current.has(clipPath)
        ) {
          deferred.reject(new Error("proxy request cancelled (no longer visible)"));
          proxyDeferredRef.current.delete(clipPath);
        }
        return;
      }

      const seq = ++proxyDemandSeqRef.current;
      proxyDemandRef.current.set(clipPath, {
        order: demand.order,
        priority: demand.priority,
        seq,
      });

      void processProxyQueue();
    },
    [processProxyQueue]
  );

  return { requestProxySequential, reportProxyDemand };
}

// --------------------
// Staggered Mount Queue
// --------------------
// When grid-preview is active, mounting all <video> elements at once can stall
// the browser / GPU decoder.  Tiles register/unregister demand (same pattern
// as the proxy queue).  Processing is deferred by one macrotask (setTimeout 0)
// so that all effects from the same render commit register their demand before
// the queue starts.  Then a setInterval ticks once every delayMs, processing
// one tile per tick (lowest index = top-left first).

type StaggerDemand = {
  order: number;
  onReady: () => void;
};

function useStaggeredMountQueue(delayMs = 50) {
  const demandRef = useRef<Map<string, StaggerDemand>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startScheduledRef = useRef(false);

  const tick = useCallback(() => {
    // Nothing left — stop the interval.
    if (demandRef.current.size === 0) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Pick the tile closest to the top-left (lowest order).
    let bestKey: string | null = null;
    let bestOrder = Infinity;
    for (const [key, entry] of demandRef.current) {
      if (entry.order < bestOrder) {
        bestOrder = entry.order;
        bestKey = key;
      }
    }
    if (!bestKey) return;

    const entry = demandRef.current.get(bestKey)!;
    demandRef.current.delete(bestKey);
    entry.onReady();
  }, []);

  const startProcessing = useCallback(() => {
    startScheduledRef.current = false;
    if (intervalRef.current !== null) return; // already running
    if (demandRef.current.size === 0) return;

    // Process the first tile immediately, then one every delayMs.
    tick();
    if (demandRef.current.size > 0) {
      intervalRef.current = setInterval(tick, delayMs);
    }
  }, [tick, delayMs]);

  const scheduleStart = useCallback(() => {
    // If already scheduled or the interval is running, new entries will be
    // picked up automatically — nothing to do.
    if (startScheduledRef.current || intervalRef.current !== null) return;
    startScheduledRef.current = true;
    // Defer to the next macrotask so all effects from this render commit
    // register their demand before we start processing.
    setTimeout(startProcessing, 0);
  }, [startProcessing]);

  const reportStaggerDemand = useCallback(
    (key: string, demand: StaggerDemand | null) => {
      if (!demand) {
        demandRef.current.delete(key);
        if (demandRef.current.size === 0 && intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      demandRef.current.set(key, demand);
      scheduleStart();
    },
    [scheduleStart]
  );

  return { reportStaggerDemand };
}

// --------------------
//   Lazy Video Cell
// --------------------

type LazyClipProps = {
  clip: { id: string; src: string, thumbnail: string };
  index: number;
  importToken: string;
  isExportSelected: boolean;
  isFocused: boolean;
  gridPreview: boolean;
  requestProxySequential: (clipPath: string, priority: boolean) => Promise<string>;
  reportProxyDemand: (clipPath: string, demand: { order: number; priority: boolean } | null) => void;
  onClipClick: (
    clipId: string,
    clipSrc: string,
    index: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => void;
  onClipDoubleClick: (
    clipId: string,
    clipSrc: string,
    index: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => void;
  registerVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  reportStaggerDemand: (key: string, demand: { order: number; onReady: () => void } | null) => void;
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
};

const LazyClip = memo(function LazyClip({
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
}: LazyClipProps) {
  // --------------------
  // State / Refs
  // --------------------
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const hasReportedErrorRef = useRef(false);
  const hasFirstFrameRef = useRef(false);
  const videoFrameCallbackIdRef = useRef<number | null>(null);
  const proxyInFlightRef = useRef(false);

  // Staggered mount: gates video mounting under grid-preview so tiles
  // mount sequentially (top-left first) instead of all at once.
  const [staggerReady, setStaggerReady] = useState(false);
  const staggerDoneRef = useRef(false);

  // When playback fails (e.g., missing HEVC codec), keep showing the thumbnail
  // while we generate/switch to a proxy instead of displaying a black video.
  const [forceThumbnail, setForceThumbnail] = useState(false);

  // Used to prevent the brief black flash when we mount/swap the <video>.
  // We keep the thumbnail visible (as an overlay) until the video reports it has data.
  const [isVideoReady, setIsVideoReady] = useState(false);

  // This tile's playback source. Starts as the original clip; may be swapped to a proxy later.
  const [effectiveSrc, setEffectiveSrc] = useState(clip.src);

  // If the imported video is HEVC and the user can't decode HEVC, we must avoid attempting
  // to mount/play the original stream and instead use an H.264 proxy.
  const needsHevcProxy = videoIsHEVC === true && userHasHEVC.current === false;
  const waitingForCodecInfo = videoIsHEVC === null && userHasHEVC.current === false;

  const showVideo = isHovered || gridPreview;
  const waitingForRequiredProxy = needsHevcProxy && effectiveSrc === clip.src;
  // During grid-preview, wait for the stagger queue unless this tile is hovered.
  const staggerGate = !gridPreview || isHovered || staggerReady;
  const shouldMountVideo =
    showVideo && !forceThumbnail && !waitingForRequiredProxy && !waitingForCodecInfo && staggerGate;
  const shouldShowThumbnail = !showVideo || !shouldMountVideo || !isVideoReady;

  // When Preview-all is enabled and we need an HEVC proxy, register demand only while visible.
  // This allows the parent to re-prioritize work when the user scrolls.
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

  useEffect(() => {
    hasReportedErrorRef.current = false;
    hasFirstFrameRef.current = false;
    proxyInFlightRef.current = false;

    const v = internalVideoRef.current;
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
  // If HEVC isn't supported, request the proxy as soon as the user hovers (or gridPreview is on),
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

        // If this tile has since been rebound to a different clip, ignore the result.
        if (clip.src !== clipPath) return;

        if (!proxyPath) {
          // If we can't generate a proxy, don't mount the (unsupported) HEVC video.
          setForceThumbnail(true);
          return;
        }

        setEffectiveSrc(proxyPath);
        setForceThumbnail(false);

        setTimeout(() => {
          const vid = internalVideoRef.current;
          if (!vid) return;
          vid.load();
          vid.play().catch(() => {});
        }, 0);
      } catch (err) {
        console.warn("ensure_preview_proxy failed", err);
        // Stay on the thumbnail; the original HEVC stream is not playable.
        setForceThumbnail(true);
      } finally {
        proxyInFlightRef.current = false;
      }
    };

    void run();
  }, [needsHevcProxy, isVisible, isHovered, gridPreview, effectiveSrc, clip.src, requestProxySequential]);

  // Stagger queue: report demand when grid-preview is on and tile is visible.
  // Same pattern as the proxy queue — register/unregister, central loop picks
  // the best candidate and calls onReady.  Hover bypasses the queue.
  useEffect(() => {
    if (!gridPreview) {
      reportStaggerDemand(clip.id, null);
      return;
    }

    // Hover bypasses the stagger queue — instant playback for the hovered tile.
    if (isHovered) {
      staggerDoneRef.current = true;
      setStaggerReady(true);
      reportStaggerDemand(clip.id, null);
      return;
    }

    // Tile scrolled out — reset and unregister.
    if (!isVisible) {
      staggerDoneRef.current = false;
      setStaggerReady(false);
      reportStaggerDemand(clip.id, null);
      return;
    }

    // Already stagger-mounted and still visible; don't re-queue.
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

    // Register demand — the central queue will call onReady when it's our turn.
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

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // Viewport gating: only mark the tile visible when it's near the viewport.
    // This keeps the grid fast (avoid mounting thumbnails/videos for off-screen tiles).
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "400px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Playback control (robust):
  // - When hovered (or grid preview mode) AND the video is mounted, ensure it loads and plays.
  // - When not hovered, pause and rewind to 0 so hover-preview always starts at the beginning.
  // We intentionally keep this separate from the proxy queue; it applies to all non-proxy playback too.
  useEffect(() => {
    const v = internalVideoRef.current;
    if (!v) return;

    const shouldPlay = showVideo && shouldMountVideo;
    if (shouldPlay) {
      // Make autoplay rules deterministic (especially in WebView).
      v.muted = true;
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
      try {
        v.currentTime = 0;
      } catch {
        // ignore
      }
    }
  }, [showVideo, shouldMountVideo, effectiveSrc]);

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

  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      internalVideoRef.current = el;
      registerVideoRef(clip.id, el);
    },
    [clip.id, registerVideoRef]
  );

  return (
    <div
      ref={wrapperRef}
      className={`clip-wrapper ${isFocused ? "focused" : ""}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      // Hover toggles isHovered, which controls whether the <video> mounts and whether playback starts.
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
            className="clip"
            src={`${convertFileSrc(clip.thumbnail)}?v=${importToken}`}
            style={{ opacity: shouldShowThumbnail ? 1 : 0 }}
            draggable={false}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
          {/* Video — only mounted when hovered or gridPreview, otherwise skip the DOM node entirely */}
          {shouldMountVideo && (
            <video
              className="clip"
              src={`${convertFileSrc(effectiveSrc)}?v=${importToken}`}
              muted
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
                // If the element mounts while hovered, give autoplay another nudge.
                if (gridPreview || isHovered) {
                  e.currentTarget.muted = true;
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
                if (hasReportedErrorRef.current) return; // if clip already ran into an error
                hasReportedErrorRef.current = true;      // flag clip as "ran into an error"

                // If the proxy itself errors, don't loop proxy generation; just fall back to thumbnail.
                if (effectiveSrc !== clip.src) {
                  setForceThumbnail(true);
                  return;
                }

                setForceThumbnail(true);

                const v = e.currentTarget;
                const errorCode = v.error?.code ?? null;
                if (import.meta.env.DEV) console.log(`Error on video -> CODE: ${errorCode}`);

                // Report to Rust for logging.
                invoke("hover_preview_error", {
                  clipId: clip.id,
                  clipPath: clip.src,
                  errorCode,
                }).catch(() => {});

                // Fallback: the original clip failed (likely HEVC that canPlayType
                // claimed was supported but the decoder can't actually handle).
                // Generate an H.264 proxy and swap to it.
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
                      const vid = internalVideoRef.current;
                      if (!vid) return;
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
        </>
      ) : (
        <div className="clip clip-skeleton" style={{ borderRadius: 15 }} />
      )}
    </div>
  );
});

// --------------------
//   Main Container
// --------------------

export default function ClipsContainer(props: ClipContainerProps) {
  // --------------------
  // Refs
  // --------------------
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Prune videoRefs when clips change so old entries don't accumulate.
  useEffect(() => {
    const validIds = new Set(props.clips.map((c) => c.id));
    const refs = videoRefs.current;
    for (const key of Object.keys(refs)) {
      if (!validIds.has(key)) delete refs[key];
    }
  }, [props.clips]);

  const { requestProxySequential, reportProxyDemand } = useViewportAwareProxyQueue();
  const { reportStaggerDemand } = useStaggeredMountQueue();

  const effectiveCols = props.loading
    ? props.cols
    : Math.max(1, Math.min(props.cols, props.clips.length));

  const clipMaxWidth = !props.loading && props.clips.length <= 2 ? 520 : 260;

  const registerVideoRef = useCallback((clipId: string, el: HTMLVideoElement | null) => {
    videoRefs.current[clipId] = el;
  }, []);

  const onClipClick = useCallback(
    (clipId: string, clipSrc: string, index: number, e: React.MouseEvent<HTMLDivElement>) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (import.meta.env.DEV) {
        (window as any).__amverge_lastClipClickT = performance.now();
        (window as any).__amverge_lastClipClickSrc = clipSrc;
      }

      // Shift-click: select export range from the current focused clip.
      if (isShift) {
        const anchorIndex = props.focusedClip
          ? props.clips.findIndex((c) => c.src === props.focusedClip)
          : -1;
        const startIndex = anchorIndex !== -1 ? anchorIndex : index;
        const [start, end] = [startIndex, index].sort((a, b) => a - b);
        const rangeIds = props.clips.slice(start, end + 1).map((c) => c.id);

        startTransition(() => {
          props.setSelectedClips(new Set(rangeIds));
        });
        return;
      }

      // Ctrl/Cmd-click: toggle export selection.
      if (isCtrl) {
        startTransition(() => {
          props.setSelectedClips((prev) => {
            const next = new Set(prev);
            next.has(clipId) ? next.delete(clipId) : next.add(clipId);
            return next;
          });
        });
        return;
      }

      // Default single-click: focus only (preview), no export selection changes.
      props.setFocusedClip(clipSrc);
    },
    [props.clips, props.focusedClip, props.setFocusedClip, props.setSelectedClips]
  );

  const onClipDoubleClick = useCallback(
    (clipId: string, clipSrc: string, _index: number, _e: React.MouseEvent<HTMLDivElement>) => {
      // Double-click: focus (first click already does), plus toggle export selection.
      props.setFocusedClip(clipSrc);
      startTransition(() => {
        props.setSelectedClips((prev) => {
          const next = new Set(prev);
          next.has(clipId) ? next.delete(clipId) : next.add(clipId);
          return next;
        });
      });
    },
    [props.setFocusedClip, props.setSelectedClips]
  );

  return (
    <main className="clips-container">
      { props.isEmpty ? (
        <p id="empty-grid">No video loaded.</p>
      ) : (
          <div
            ref={props.gridRef}
            className="clips-grid"
            style={{
              gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`,
              // Let 1–2 clips scale up instead of staying clamped.
              // The CSS reads this as `max-width` for each tile.
              ["--clip-max-width" as any]: `${clipMaxWidth}px`,
            }}
          >
            {props.loading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="clip-skeleton" />
                ))
              : props.clips.map((clip, index) => (
                  <LazyClip
                    key={clip.id}
                    clip={clip}
                    index={index}
                    importToken={props.importToken}
                    isExportSelected={props.selectedClips.has(clip.id)}
                    isFocused={props.focusedClip === clip.src}
                    gridPreview={props.gridPreview}
                    requestProxySequential={requestProxySequential}
                    reportProxyDemand={reportProxyDemand}
                    registerVideoRef={registerVideoRef}
                    reportStaggerDemand={reportStaggerDemand}
                    onClipClick={onClipClick}
                    onClipDoubleClick={onClipDoubleClick}
                    videoIsHEVC={props.videoIsHEVC}
                    userHasHEVC={props.userHasHEVC}
                  />
                ))}
          </div>
       )}
    </main>
  );
}