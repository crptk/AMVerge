import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type UseEditorVideoPlayerArgs = {
    selectedClip: string;
    videoIsHEVC: boolean | null;
    userHasHEVC: React.RefObject<boolean>;
    externalTime?: number;
    onTimeUpdate?: (time: number) => void;
    isPlaying: boolean;
    isDragging?: boolean;
};

export function useEditorVideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
    externalTime,
    onTimeUpdate,
    isPlaying,
    isDragging,
}: UseEditorVideoPlayerArgs) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const scrubTimeoutRef = useRef<number | null>(null);
    const [effectiveClip, setEffectiveClip] = useState<string | null>(selectedClip);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const hasHevcSupport = userHasHEVC.current === true;

    // 1. Handle Clip Changes & Proxy Fallback
    useEffect(() => {
        if (!selectedClip) {
            setEffectiveClip(null);
            setIsVideoReady(false);
            return;
        }

        if (hasHevcSupport || videoIsHEVC === false) {
            setEffectiveClip(selectedClip);
            return;
        }

        invoke<string>("ensure_preview_proxy", { clipPath: selectedClip })
            .then((proxyPath) => {
                if (proxyPath) setEffectiveClip(proxyPath);
            })
            .catch(() => {
                setEffectiveClip(selectedClip);
            });
    }, [selectedClip, videoIsHEVC, hasHevcSupport]);

    useEffect(() => {
        if (externalTime === undefined || !videoRef.current) return;
        
        const video = videoRef.current;
        if (!video || video.readyState < 1) return;

        const targetTime = Math.min(externalTime, video.duration || Infinity);
        const diff = Math.abs(video.currentTime - targetTime);
        
        if (isPlaying && diff < 0.2) return;

        if (diff > 0.005) {
            video.currentTime = targetTime;
        }
    }, [externalTime, isPlaying, isDragging]);

    useEffect(() => {
        return () => {
            if (scrubTimeoutRef.current) window.clearTimeout(scrubTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (isPlaying && video.paused) {
            video.play().catch((err) => {
                console.warn("[useEditorVideoPlayer] Play failed:", err);
            });
        } else if (!isPlaying && !video.paused) {
            video.pause();
        }
    }, [isPlaying]);

    const handleLoadedMetadata = (_video: HTMLVideoElement) => {
        setIsVideoReady(true);
    };

    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;

    // High-precision playhead polling for the timeline
    useEffect(() => {
        if (!isPlaying || !videoRef.current) return;

        let rafId: number;
        const video = videoRef.current;

        const poll = () => {
            if (onTimeUpdateRef.current && !video.paused) {
                onTimeUpdateRef.current(video.currentTime);
            }
            rafId = requestAnimationFrame(poll);
        };

        rafId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafId);
    }, [isPlaying]);

    const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
        const video = e.currentTarget;
        console.error("[useEditorVideoPlayer] Video load error:", {
            error: video.error,
            src: video.src,
            effectiveClip
        });
        setIsVideoReady(false);
    };

    const handleTimeUpdate = (isEnded?: boolean) => {
        const video = videoRef.current;
        if (video && onTimeUpdateRef.current && (!video.paused || isEnded)) {
            onTimeUpdateRef.current(video.currentTime, isEnded);
        }
    };

    return {
        videoRef,
        effectiveClip,
        handleLoadedMetadata,
        handleVideoError,
        handleTimeUpdate,
    };
}