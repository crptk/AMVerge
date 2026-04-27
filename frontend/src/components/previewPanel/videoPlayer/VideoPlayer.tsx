import type { RefObject } from "react";
import { FaExpand, FaPause, FaPlay, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVideoPlayer } from "./useVideoPlayer";

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
    });

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