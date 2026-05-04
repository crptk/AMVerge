import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useAppStateStore } from "../../../stores/appStore";

type UseEditorVideoPlayerArgs = {
    selectedClip: string;
    externalTime?: number;
    onTimeUpdate?: (time: number, isEnded?: boolean) => void;
    isPlaying: boolean;
    isDragging?: boolean;
};

export function useEditorVideoPlayer({
    selectedClip,
    externalTime,
    onTimeUpdate,
    isPlaying,
    isDragging,
}: UseEditorVideoPlayerArgs) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const scrubTimeoutRef = useRef<number | null>(null);
    const [effectiveClip, setEffectiveClip] = useState<string | null>(selectedClip);

    
    const userHasHEVC = useAppStateStore((state) => state.userHasHEVC);
    const videoIsHEVC = useAppStateStore((state) => state.videoIsHEVC);

    const hasHevcSupport = userHasHEVC === true;

    // 1. Handle Clip Changes & Proxy Fallback
    useEffect(() => {
        if (!selectedClip) {
            setEffectiveClip(null);
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
