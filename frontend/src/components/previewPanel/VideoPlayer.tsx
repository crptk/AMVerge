import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FaExpand, FaPause, FaPlay, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type VideoPlayerProps = {
    selectedClip: string;
    videoIsHEVC: boolean | null;
    userHasHEVC: RefObject<boolean>;
    posterPath: string | null;
    importToken: string;
};

export default function VideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
    posterPath,
    importToken,
}: VideoPlayerProps) {
    // --------------------
    // Refs / State
    // --------------------
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

    // --------------------
    // Helpers
    // --------------------
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

        // Only proxy for HEVC-missing-support scenarios.
        if (hasHevcSupport) return;
        if (videoIsHEVC !== true) return;

        // Only auto-proxy when we are still trying to play the original.
        if (!effectiveClip || effectiveClip !== selectedClip) return;

        // Avoid retry loops for the same clip.
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
                if (!proxyPath) {
                    proxyInFlightRef.current = false;
                    return;
                }

                setEffectiveClip(proxyPath);
                proxyInFlightRef.current = false;
                setTimeout(() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.load();
                    safePlay(v);
                }, 0);
            })
            .catch((err) => {
                if (import.meta.env.DEV) console.warn("ensure_preview_proxy failed", err);
                proxyInFlightRef.current = false;
            });
    };

    const safePlay = (video: HTMLVideoElement) => {
        if (!video.src || video.readyState === 0) return;
        requestFirstFrame(video);

        video.play().catch((err: any) => {
            const name = err?.name as string | undefined;

            // AbortError can happen during rapid src changes.
            if (name === "AbortError") return;

            if (import.meta.env.DEV) {
                console.warn("[VideoPlayer] play() rejected", {
                    name,
                    message: err?.message,
                    selectedClip,
                });
            }

            // If the codec/container is unsupported, proactively proxy.
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

    // --------------------
    // Effects
    // --------------------
    useEffect(() => {
        selectedClipRef.current = selectedClip;
    }, [selectedClip]);

    // Reset UI state for the newly selected clip.
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

    // HEVC source selection:
    // - If the WebView can decode HEVC, always use the original clip.
    // - If it can't decode HEVC and the imported video is HEVC, proactively switch to H.264 proxy.
    // - If codec info is unknown, keep src empty to avoid black-screen attempts.
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

        // HEVC + no support: request and use proxy.
        if (effectiveClip && effectiveClip !== selectedClip) return; // already on a proxy
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
    }, [selectedClip, videoIsHEVC, hasHevcSupport, effectiveClip]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore typing in inputs/textareas.
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
                e.preventDefault(); // stops page scroll
                if (video.paused) {
                    video.play();
                    setIsPlaying(true);
                } else {
                    video.pause();
                    setIsPlaying(false);
                }
            }

            if (e.code === "ArrowRight") {
                e.preventDefault();
                video.currentTime = Math.min(video.duration, video.currentTime + 1);
            }

            if (e.code === "ArrowLeft") {
                e.preventDefault();
                video.currentTime = Math.min(video.duration, video.currentTime - 1);
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

    // --------------------
    // Render
    // --------------------
    return (
        <div className="video-wrapper">
            <div className="video-frame">
                <video
                    ref={videoRef}
                    src={effectiveClip ? `${convertFileSrc(effectiveClip)}?v=${importToken}` : undefined}
                    poster={posterPath ? `${convertFileSrc(posterPath)}?v=${importToken}` : undefined}
                    preload="metadata"
                    muted
                    loop
                    draggable={false}
                    onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    style={{ opacity: isVideoReady ? 1 : 0 }}
                    onError={(e) => {
                        const v = e.currentTarget;
                        triggerProxyFallback(`onError_${v.error?.code ?? "unknown"}`);
                    }}
                    onLoadedMetadata={(e) => {
                        const video = e.currentTarget;
                        video.style.setProperty("--aspect-ratio", `${video.videoWidth} / ${video.videoHeight}`);
                        setDuration(video.duration);
                        requestFirstFrame(video);
                        safePlay(video);
                    }}
                    onLoadedData={() => {
                        setIsVideoReady(true);
                    }}
                    onTimeUpdate={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        setCurrentTime(v.currentTime);
                    }}
                    onPlay={(e) => {
                        requestFirstFrame(e.currentTarget);
                        setIsPlaying(true);
                        setIsVideoReady(true);
                    }}
                    onPause={() => setIsPlaying(false)}
                    onClick={togglePlay}
                />

                <div id="video-controls" className="controls" data-state="hidden">
                    <button type="button" onClick={togglePlay}>
                        {isPlaying ? <FaPause /> : <FaPlay />}
                    </button>

                    <div
                        ref={progressRef}
                        className="progress"
                        onClick={(e) => {
                            if (!videoRef.current || !duration) return;
                            seekFromMouseEvent(e, e.currentTarget);
                        }}
                        onMouseDown={(e) => {
                            const video = videoRef.current;
                            if (!video) return;
                            wasPlayingRef.current = !video.paused;
                            video.pause();
                            setIsScrubbing(true);
                            seekFromMouseEvent(e, e.currentTarget);
                        }}
                    >
                        <progress value={currentTime} max={duration}>
                            <span id="progress-bar"></span>
                        </progress>
                    </div>

                    <button id="mute" type="button" onClick={toggleMute}>
                        {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
                    </button>
                    <button id="fs" type="button" onClick={goFullScreen}>
                        <FaExpand />
                    </button>
                </div>
            </div>
        </div>
    );
}