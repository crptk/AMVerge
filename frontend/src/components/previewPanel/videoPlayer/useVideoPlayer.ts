import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

type UseVideoPlayerArgs = {
    selectedClip: string;
    videoIsHEVC: boolean | null;
    userHasHEVC: RefObject<boolean>;
};

export function useVideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
}: UseVideoPlayerArgs) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const progressRef = useRef<HTMLDivElement | null>(null);

    const selectedClipRef = useRef<string>(selectedClip);
    const proxyInFlightRef = useRef(false);
    const proxyAttemptedForClipRef = useRef<string | null>(null);

    const hasFirstFrameRef = useRef(false);
    const videoFrameCallbackIdRef = useRef<number | null>(null);

    const wasPlayingRef = useRef(false);
    const rafRef = useRef<number | null>(null);

    const [effectiveClip, setEffectiveClip] = useState<string | null>(selectedClip);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);

    const hasHevcSupport = userHasHEVC.current === true;

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

    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;

        if (video.paused) {
            video.play();
            setIsPlaying(true);
        } else {
            video.pause();
            setIsPlaying(false);
        }
    };

    const toggleMute = () => {
        const video = videoRef.current;
        if (!video) return;

        video.muted = !video.muted;
        setIsMuted(video.muted);
    };

    const goFullScreen = () => {
        const video = videoRef.current;
        if (!video) return;

        if (video.requestFullscreen) video.requestFullscreen();
    };

    const handleLoadedMetadata = (video: HTMLVideoElement) => {
        video.style.setProperty("--aspect-ratio", `${video.videoWidth} / ${video.videoHeight}`);
        setDuration(video.duration);
        requestFirstFrame(video);
        safePlay(video);
    };

    const handleLoadedData = () => {
        setIsVideoReady(true);
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;

        setCurrentTime(video.currentTime);
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

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !selectedClip) return;

        proxyInFlightRef.current = false;
        proxyAttemptedForClipRef.current = null;
        hasFirstFrameRef.current = false;

        if (videoFrameCallbackIdRef.current && (video as any).cancelVideoFrameCallback) {
            try {
                (video as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
            } catch {
                // ignore
            }
        }

        videoFrameCallbackIdRef.current = null;

        setEffectiveClip(null);
        setIsVideoReady(false);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
    }, [selectedClip]);

    useEffect(() => {
        if (!selectedClip) {
            setEffectiveClip(null);
            setIsVideoReady(false);
            return;
        }

        if (hasHevcSupport) {
            if (effectiveClip !== selectedClip) setEffectiveClip(selectedClip);
            setIsVideoReady(false);
            return;
        }

        if (videoIsHEVC === null) {
            if (effectiveClip !== null) setEffectiveClip(null);
            setIsVideoReady(false);
            return;
        }

        if (videoIsHEVC === false) {
            if (effectiveClip !== selectedClip) setEffectiveClip(selectedClip);
            setIsVideoReady(false);
            return;
        }

        if (effectiveClip && effectiveClip !== selectedClip) return;
        if (proxyInFlightRef.current) return;
        if (proxyAttemptedForClipRef.current === selectedClip) return;

        proxyAttemptedForClipRef.current = selectedClip;
        proxyInFlightRef.current = true;

        setEffectiveClip(null);
        setIsVideoReady(false);

        invoke<string>("ensure_preview_proxy", { clipPath: selectedClip })
            .then((proxyPath) => {
                proxyInFlightRef.current = false;
                if (!proxyPath) return;
                if (selectedClipRef.current !== selectedClip) return;

                setEffectiveClip(proxyPath);
                setIsVideoReady(false);

                setTimeout(() => {
                    const video = videoRef.current;
                    if (!video) return;
                    video.load();
                    safePlay(video);
                }, 0);
            })
            .catch((err) => {
                proxyInFlightRef.current = false;
                if (import.meta.env.DEV) console.warn("ensure_preview_proxy failed", err);
            });
    }, [selectedClip, videoIsHEVC, hasHevcSupport, effectiveClip]);

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
                togglePlay();
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
                goFullScreen();
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