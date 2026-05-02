import React, { useEffect, type RefObject } from "react";
import { FaExpand, FaPause, FaPlay, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVideoPlayer } from "./useVideoPlayer";
import { useAppStateStore } from "../../../store/appStore";

type VideoPlayerProps = {
    selectedClip: string;
    videoIsHEVC: boolean | null;
    userHasHEVC: RefObject<boolean>;
    posterPath: string | null;
    externalTime?: number;
    onTimeUpdate?: (time: number) => void;
};

export default function VideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
    posterPath,
    externalTime,
    onTimeUpdate,
}: VideoPlayerProps) {
    useEffect(() => {
        console.log("[VideoPlayer] Mounted with clip:", selectedClip);
        return () => console.log("[VideoPlayer] Unmounted clip:", selectedClip);
    }, [selectedClip]);

    const {
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
    } = useVideoPlayer({
        selectedClip,
        videoIsHEVC,
        userHasHEVC,
        externalTime,
        onTimeUpdate,
    });

    const importToken = useAppStateStore(s => s.importToken);
    
    return (
        <div className="video-wrapper">
            <div className="video-frame">
                <video
                    ref={videoRef}
                    src={effectiveClip ? `${convertFileSrc(effectiveClip)}?v=${importToken}` : undefined}
                    poster={(externalTime === undefined) && posterPath ? `${convertFileSrc(posterPath)}?v=${importToken}` : undefined}
                    preload="metadata"
                    muted
                    loop
                    draggable={false}
                    onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    onError={(e) => {
                        const video = e.currentTarget;
                        triggerProxyFallback(`onError_${video.error?.code ?? "unknown"}`);
                    }}
                    onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget)}
                    onLoadedData={handleLoadedData}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={(e) => handlePlay(e.currentTarget)}
                    onPause={handlePause}
                    onClick={togglePlay}
                />

                <div className="controls" data-state="hidden">
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
                        onMouseDown={handleProgressMouseDown}
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