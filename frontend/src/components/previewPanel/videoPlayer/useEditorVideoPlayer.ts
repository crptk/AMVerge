import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import useHighPrecisionFilmstrip from "../../../hooks/useHighPrecisionFilmstrip";

type UseEditorVideoPlayerArgs = {
    selectedClip: string;
    videoIsHEVC: boolean | null;
    userHasHEVC: React.RefObject<boolean>;
    externalTime?: number;
    onTimeUpdate?: (time: number) => void;
    clipId: string;
    isPlaying: boolean;
};

export function useEditorVideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
    externalTime,
    onTimeUpdate,
    clipId,
    isPlaying,
}: UseEditorVideoPlayerArgs) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [effectiveClip, setEffectiveClip] = useState<string | null>(selectedClip);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const hasHevcSupport = userHasHEVC.current === true;

    // Load High Precision metadata
    const hpFilmstrip = useHighPrecisionFilmstrip(selectedClip, clipId);

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
    //    Use video.readyState inline instead of isVideoReady state to avoid
    //    race conditions where the state update hasn't happened yet.
    useEffect(() => {
        if (externalTime === undefined || !videoRef.current) return;
        
        const video = videoRef.current;
        
        // Check readyState directly — more reliable than boolean state
        if (video.readyState < 2) return;

        // Clamp to video duration to prevent stuck seeking logs
        const targetTime = Math.min(externalTime, video.duration || Infinity);
        const diff = Math.abs(video.currentTime - targetTime);
        
        // Prevent feedback loop: If playing, only allow significant jumps (scrubbing)
        if (isPlaying && diff < 0.1) {
            return;
        }

        // Lower threshold for frame-accurate scrubbing
        if (diff > 0.005) {
            video.currentTime = targetTime;
        }
    }, [externalTime, isPlaying]);

    // 3. Synchronize isPlaying -> video.play()/pause()
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isVideoReady) return;

        if (isPlaying && video.paused) {
            video.play().catch(() => {});
        } else if (!isPlaying && !video.paused) {
            video.pause();
        }
    }, [isPlaying, isVideoReady]);

    const handleLoadedMetadata = (_video: HTMLVideoElement) => {
        setIsVideoReady(true);
    };

    // 4. Smooth 60fps Playhead Polling — use a ref for onTimeUpdate to avoid stale closures
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;

    useEffect(() => {
        if (!isPlaying || !videoRef.current || !isVideoReady) return;

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
    }, [isPlaying, isVideoReady]);

    const handleTimeUpdate = () => {
        // Fallback for standard events, though the RAF loop above handles the smooth updates
        const video = videoRef.current;
        if (video && onTimeUpdate && !video.paused) {
            onTimeUpdate(video.currentTime);
        }
    };

    return {
        videoRef,
        effectiveClip,
        handleLoadedMetadata,
        handleTimeUpdate,
        hpFilmstrip,
    };
}
