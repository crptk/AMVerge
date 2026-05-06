import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useAppStateStore } from "../../../stores/appStore";

type UseEditorVideoPlayerArgs = {
    selectedClip: string;
    mergedSrcs?: string[];
    externalTime?: number;
    onTimeUpdate?: (time: number, isEnded?: boolean) => void;
    isPlaying: boolean;
    isDragging?: boolean;
};

export function useEditorVideoPlayer({
    selectedClip,
    mergedSrcs,
    externalTime,
    onTimeUpdate,
    isPlaying,
    isDragging,
}: UseEditorVideoPlayerArgs) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const scrubTimeoutRef = useRef<number | null>(null);
    const mergedPreviewInFlightRef = useRef(false);
    const mergedPreviewFetchedKeyRef = useRef<string | null>(null);
    const [effectiveClip, setEffectiveClip] = useState<string | null>(selectedClip);
    const [mergedPreviewClip, setMergedPreviewClip] = useState<string | null>(null);

    
    const userHasHEVC = useAppStateStore((state) => state.userHasHEVC);
    const videoIsHEVC = useAppStateStore((state) => state.videoIsHEVC);

    const hasHevcSupport = userHasHEVC === true;

    useEffect(() => {
        if (!mergedSrcs || mergedSrcs.length <= 1) {
            mergedPreviewFetchedKeyRef.current = null;
            mergedPreviewInFlightRef.current = false;
            setMergedPreviewClip(null);
            return;
        }

        if (videoIsHEVC === true && !hasHevcSupport) {
            setMergedPreviewClip(null);
            return;
        }

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
    }, [mergedSrcs, videoIsHEVC, hasHevcSupport]);

    // 1. Handle Clip Changes & Proxy Fallback
    useEffect(() => {
        if (!selectedClip) {
            setMergedPreviewClip(null);
            setEffectiveClip(null);
            return;
        }

        if (hasHevcSupport || videoIsHEVC === false) {
            setEffectiveClip(mergedPreviewClip ?? selectedClip);
            return;
        }

        invoke<string>("ensure_preview_proxy", { clipPath: selectedClip })
            .then((proxyPath) => {
                if (proxyPath) setEffectiveClip(proxyPath);
            })
            .catch(() => {
                setEffectiveClip(selectedClip);
            });
    }, [selectedClip, mergedPreviewClip, videoIsHEVC, hasHevcSupport]);

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
