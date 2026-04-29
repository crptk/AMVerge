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

        // HEVC Proxy check
        invoke<string>("ensure_preview_proxy", { clipPath: selectedClip })
            .then((proxyPath) => {
                if (proxyPath) setEffectiveClip(proxyPath);
            })
            .catch(() => {
                setEffectiveClip(selectedClip); // Fallback to original
            });
    }, [selectedClip, videoIsHEVC, hasHevcSupport]);

    // 2. Synchronize externalTime -> video.currentTime
    useEffect(() => {
        if (externalTime === undefined || !videoRef.current) return;
        
        const video = videoRef.current;
        if (video.readyState < 2) return;

        const targetTime = Math.min(externalTime, video.duration || Infinity);
        const diff = Math.abs(video.currentTime - targetTime);
        
        // IF PLAYING: Only jump if the drift is large (> 0.2s).
        // This allows natural playback to continue without jitter, but
        // still handles jumps between segments or manual playhead jumps.
        if (isPlaying && diff < 0.2) return;

        if (diff > 0.005) {
            if (isDragging) {
                if (scrubTimeoutRef.current) {
                    window.clearTimeout(scrubTimeoutRef.current);
                }
                
                scrubTimeoutRef.current = window.setTimeout(() => {
                    video.currentTime = targetTime;
                    scrubTimeoutRef.current = null;
                }, 30);
            } else {
                video.currentTime = targetTime;
            }
        }
    }, [externalTime, isPlaying, isDragging]);

    // Cleanup timeout
    useEffect(() => {
        return () => {
            if (scrubTimeoutRef.current) window.clearTimeout(scrubTimeoutRef.current);
        };
    }, []);

    // 3. Synchronize isPlaying -> video.play()/pause()
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

    // 4. Smooth 60fps Playhead Polling — reports back to timeline
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;

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

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (video && onTimeUpdateRef.current && !video.paused) {
            onTimeUpdateRef.current(video.currentTime);
        }
    };

    return {
        videoRef,
        effectiveClip,
        handleLoadedMetadata,
        handleTimeUpdate,
    };
}
