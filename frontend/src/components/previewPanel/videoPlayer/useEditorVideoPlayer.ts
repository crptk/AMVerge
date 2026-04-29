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
    useEffect(() => {
        if (externalTime === undefined || !videoRef.current) return;
        
        const video = videoRef.current;
        
        // If duration is 0, metadata might not be loaded yet
        if (video.duration === 0 || isNaN(video.duration)) {
            return;
        }

        // Clamp to video duration to prevent stuck seeking logs
        const targetTime = Math.min(externalTime, video.duration);
        const diff = Math.abs(video.currentTime - targetTime);
        
        // Prevent feedback loop: If the video is playing, don't let externalTime (which comes 
        // from the timeline) jerk the playhead back unless it's a significant jump (scrubbing).
        if (isPlaying && diff < 0.1) {
            return;
        }

        if (diff > 0.01) {
            video.currentTime = targetTime;
        }
    }, [externalTime, isVideoReady, isPlaying]);

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

    const handleLoadedMetadata = (video: HTMLVideoElement) => {
        setIsVideoReady(true);
    };

    // 4. Smooth 60fps Playhead Polling
    useEffect(() => {
        if (!isPlaying || !videoRef.current || !isVideoReady) return;

        let rafId: number;
        const video = videoRef.current;

        const poll = () => {
            if (onTimeUpdate && !video.paused) {
                onTimeUpdate(video.currentTime);
            }
            rafId = requestAnimationFrame(poll);
        };

        rafId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafId);
    }, [isPlaying, isVideoReady, onTimeUpdate]);

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
