import { useEffect, useRef, useState, useCallback } from "react";

import { invoke } from "@tauri-apps/api/core";

type UseVideoPlayerArgs = {
    selectedClip: string;
    mergedSrcs?: string[];
    videoIsHEVC: boolean | null;
    userHasHEVC: boolean;
    externalTime?: number;
    onTimeUpdate?: (time: number) => void;
};

export function useVideoPlayer({
    selectedClip,
    mergedSrcs,
    videoIsHEVC,
    userHasHEVC,
    externalTime,
    onTimeUpdate,
}: UseVideoPlayerArgs) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const progressRef = useRef<HTMLDivElement | null>(null);

    const selectedClipRef = useRef<string>(selectedClip);
    const proxyInFlightRef = useRef(false);
    const proxyAttemptedForClipRef = useRef<string | null>(null);
    const mergedPreviewInFlightRef = useRef(false);
    const mergedPreviewFetchedKeyRef = useRef<string | null>(null);

    const hasFirstFrameRef = useRef(false);
    const videoFrameCallbackIdRef = useRef<number | null>(null);

    const wasPlayingRef = useRef(false);
    const rafRef = useRef<number | null>(null);

    // Seek generation: incremented on clip change to discard stale seeks
    const seekGenerationRef = useRef(0);

    const [effectiveClip, setEffectiveClip] = useState<string | null>(selectedClip);
    const mergedSrcsKey = mergedSrcs ? mergedSrcs.join("|") : null;
    const [mergedPreviewClip, setMergedPreviewClip] = useState<string | null>(null);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);

    const hasHevcSupport = userHasHEVC === true;

    const requestFirstFrame = (video: HTMLVideoElement) => {
        if (hasFirstFrameRef.current) return;
        if (!(video as any).requestVideoFrameCallback) return;
        if (videoFrameCallbackIdRef.current) return;

        try {
            videoFrameCallbackIdRef.current = (video as any).requestVideoFrameCallback(() => {
                hasFirstFrameRef.current = true;
                videoFrameCallbackIdRef.current = null;
            });
        } catch {
            // ignore
        }
    };

    const triggerProxyFallback = (reason: string) => {
        const video = videoRef.current;
        if (!video) return;

        if (proxyInFlightRef.current) return;
        if (!selectedClip) return;
        if (hasHevcSupport) return;
        if (videoIsHEVC !== true) return;
        if (!effectiveClip || effectiveClip !== selectedClip) return;
        if (proxyAttemptedForClipRef.current === selectedClip) return;

        proxyAttemptedForClipRef.current = selectedClip;
        proxyInFlightRef.current = true;

        if (import.meta.env.DEV) {
            console.warn("[VideoPlayer] triggering proxy fallback", {
                reason,
                selectedClip,
                readyState: video.readyState,
                networkState: video.networkState,
                errorCode: video.error?.code ?? null,
            });
        }

        invoke<string>("ensure_preview_proxy", { clipPath: selectedClip })
            .then((proxyPath) => {
                proxyInFlightRef.current = false;
                if (!proxyPath) return;

                setEffectiveClip(proxyPath);

                setTimeout(() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.load();
                    safePlay(v);
                }, 0);
            })
            .catch((err) => {
                proxyInFlightRef.current = false;
                if (import.meta.env.DEV) console.warn("ensure_preview_proxy failed", err);
            });
    };

    const safePlay = (video: HTMLVideoElement) => {
        if (!video.src || video.readyState === 0) return;

        requestFirstFrame(video);

        video.play().catch((err: any) => {
            const name = err?.name as string | undefined;

            if (name === "AbortError") return;

            if (import.meta.env.DEV) {
                console.warn("[VideoPlayer] play() rejected", {
                    name,
                    message: err?.message,
                    selectedClip,
                });
            }

            if (name === "NotSupportedError") {
                triggerProxyFallback("play_rejected_NotSupportedError");
            }
        });
    };

    const seekFromMouseEvent = (e: MouseEvent | React.MouseEvent, target: HTMLDivElement) => {
        const video = videoRef.current;
        if (!video || !duration) return;

        const rect = target.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
        const percentage = x / rect.width;

        video.currentTime = percentage * duration;
    };

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        if (video.paused) {
            video.play();
            setIsPlaying(true);
        } else {
            video.pause();
            setIsPlaying(false);
        }
    }, []);

    const toggleMute = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        video.muted = !video.muted;
        setIsMuted(video.muted);
    }, []);

    const goFullScreen = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        if (video.requestFullscreen) video.requestFullscreen();
    }, []);

    const handleLoadedMetadata = (video: HTMLVideoElement) => {
        video.style.setProperty("--aspect-ratio", `${video.videoWidth} / ${video.videoHeight}`);
        setDuration(video.duration);
        requestFirstFrame(video);
        if (isPlaying) safePlay(video);
    };

    const handleLoadedData = () => {
        setIsVideoReady(true);
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;

        setCurrentTime(video.currentTime);
        
        // Only drive the timeline from the video if the video is fully ready.
        if (isVideoReady) {
            // If playing or scrubbing, sync to timeline
            if (!video.paused || isScrubbing) {
                if (onTimeUpdate) {
                    if (import.meta.env.DEV && !video.paused) {
                        console.log("[VideoPlayer] Syncing to Timeline ->", video.currentTime.toFixed(3));
                    }
                    onTimeUpdate(video.currentTime);
                }
            }
        }
    };

    const handlePlay = (video: HTMLVideoElement) => {
        requestFirstFrame(video);
        setIsPlaying(true);
        setIsVideoReady(true);
    };

    const handlePause = () => {
        setIsPlaying(false);
    };

    const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        const video = videoRef.current;
        if (!video) return;

        wasPlayingRef.current = !video.paused;
        video.pause();
        setIsScrubbing(true);
        seekFromMouseEvent(e, e.currentTarget);
    };

    useEffect(() => {
        selectedClipRef.current = selectedClip;
    }, [selectedClip]);

    // Merged preview: stream-copy concat for clips with mergedSrcs
    useEffect(() => {
        if (!mergedSrcs || mergedSrcs.length <= 1) {
            mergedPreviewFetchedKeyRef.current = null;
            mergedPreviewInFlightRef.current = false;
            setMergedPreviewClip(null);
            return;
        }
        if (videoIsHEVC === true && !hasHevcSupport) return;

        const key = mergedSrcs.join("|");
        if (mergedPreviewFetchedKeyRef.current === key) return;
        if (mergedPreviewInFlightRef.current) return;

        mergedPreviewFetchedKeyRef.current = key;
        mergedPreviewInFlightRef.current = true;

        invoke<string>("ensure_merged_preview", { srcs: mergedSrcs })
            .then((path) => {
                mergedPreviewInFlightRef.current = false;
                if (mergedPreviewFetchedKeyRef.current !== key) return;
                setMergedPreviewClip(path);
            })
            .catch((err) => {
                mergedPreviewInFlightRef.current = false;
                mergedPreviewFetchedKeyRef.current = null;
                setMergedPreviewClip(null);
                if (import.meta.env.DEV) console.warn("ensure_merged_preview failed", err);
            });
    }, [mergedSrcsKey, videoIsHEVC, hasHevcSupport]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Bump seek generation so stale externalTime seeks are discarded
        seekGenerationRef.current++;

        // 1. Handle Empty State
        if (!selectedClip) {
            setMergedPreviewClip(null);
            setEffectiveClip(null);
            setIsVideoReady(false);
            setCurrentTime(0);
            setDuration(0);
            setIsPlaying(false);
            return;
        }

        // 2. Cleanup old clip state
        proxyInFlightRef.current = false;
        proxyAttemptedForClipRef.current = null;
        hasFirstFrameRef.current = false;
        // NOTE: do NOT reset mergedPreviewInFlightRef / mergedPreviewFetchedKeyRef here.
        // The merged-preview effect manages those refs; clearing them here races with the
        // in-flight invoke and causes the resolved path to be silently discarded.

        if (videoFrameCallbackIdRef.current && (video as any).cancelVideoFrameCallback) {
            try {
                (video as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
            } catch { /* ignore */ }
        }
        videoFrameCallbackIdRef.current = null;

        // 3. Determine if we can use the source directly or need a proxy
        if (hasHevcSupport || videoIsHEVC === false) {
            const nextClip = mergedPreviewClip ?? selectedClip;
            if (effectiveClip !== nextClip) {
                setEffectiveClip(nextClip);
                setIsVideoReady(false);
            }
            return;
        }

        if (videoIsHEVC === null) {
            setIsVideoReady(false);
            return;
        }

        // 4. Proxy Logic
        if (effectiveClip && effectiveClip !== selectedClip) {
            setIsVideoReady(false);
        }

        if (proxyInFlightRef.current || proxyAttemptedForClipRef.current === selectedClip) return;

        proxyAttemptedForClipRef.current = selectedClip;
        proxyInFlightRef.current = true;

        invoke<string>("ensure_preview_proxy", { clipPath: selectedClip })
            .then((proxyPath) => {
                proxyInFlightRef.current = false;
                if (!proxyPath || selectedClipRef.current !== selectedClip) return;

                setEffectiveClip(proxyPath);
                setIsVideoReady(false);

                setTimeout(() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.load();
                    if (isPlaying) safePlay(v);
                }, 0);
            })
            .catch((err) => {
                proxyInFlightRef.current = false;
                if (import.meta.env.DEV) console.warn("ensure_preview_proxy failed", err);
                // Fallback to original even if proxy failed
                setEffectiveClip(selectedClip);
            });
    }, [selectedClip, mergedPreviewClip, videoIsHEVC, hasHevcSupport]);

    // Keyboard shortcuts — use stable callbacks
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                (e.target as HTMLElement)?.isContentEditable
            ) {
                return;
            }

            const video = videoRef.current;
            if (!video) return;

            if (e.code === "Space") {
                e.preventDefault();
                if (video.paused) {
                    video.play();
                } else {
                    video.pause();
                }
            }

            if (e.code === "ArrowRight") {
                e.preventDefault();
                video.currentTime = Math.min(video.duration, video.currentTime + 1);
            }

            if (e.code === "ArrowLeft") {
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - 1);
            }

            if (e.code === "KeyF") {
                e.preventDefault();
                if (video.requestFullscreen) video.requestFullscreen();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        if (!isScrubbing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (rafRef.current) return;

            rafRef.current = requestAnimationFrame(() => {
                const progressEl = progressRef.current;
                if (progressEl) seekFromMouseEvent(e, progressEl);
                rafRef.current = null;
            });
        };

        const handleMouseUp = () => {
            const video = videoRef.current;
            if (video && wasPlayingRef.current) video.play();
            setIsScrubbing(false);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);

            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [isScrubbing, duration]);

    // External time seeking — waits for video to be fully loaded and ready
    useEffect(() => {
        if (externalTime === undefined) return;

        const video = videoRef.current;
        if (!video) return;

        // Don't seek until the video is actually loaded and has valid duration
        if (!isVideoReady || !duration || duration <= 0) return;

        const diff = Math.abs(video.currentTime - externalTime);
        const isSignificantJump = diff > 0.1;
        
        // Skip small corrections during playback to avoid jitter
        if (isPlaying && !isSignificantJump) return;

        if (diff > 0.01) {
            // Clamp to valid range
            const clampedTime = Math.max(0, Math.min(externalTime, duration));
            video.currentTime = clampedTime;
            setCurrentTime(clampedTime);
        }
    }, [externalTime, duration, isVideoReady]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !effectiveClip) return;

        setIsVideoReady(false);
        video.load();

        if (isPlaying) {
            safePlay(video);
        }
    }, [effectiveClip]);

    return {
        videoRef,
        progressRef,

        effectiveClip,
        isVideoReady,
        isPlaying,
        isMuted,
        currentTime,
        duration,

        togglePlay,
        toggleMute,
        goFullScreen,
        seekFromMouseEvent,
        triggerProxyFallback,

        handleLoadedMetadata,
        handleLoadedData,
        handleTimeUpdate,
        handlePlay,
        handlePause,
        handleProgressMouseDown,
    };
}