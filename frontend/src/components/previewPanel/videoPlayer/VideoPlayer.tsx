import { FaExpand, FaPause, FaPlay, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVideoPlayer } from "./useVideoPlayer";

function formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}

type VideoPlayerProps = {
    selectedClip: string;
    mergedSrcs?: string[];
    videoIsHEVC: boolean | null;
    userHasHEVC: boolean;
    posterPath: string | null;
    importToken: string;
    externalTime?: number;
    onTimeUpdate?: (time: number) => void;
};

export default function VideoPlayer({
    selectedClip,
    mergedSrcs,
    videoIsHEVC,
    userHasHEVC,
    posterPath,
    importToken,
    externalTime,
    onTimeUpdate,
}: VideoPlayerProps) {
    const {
        videoRef,
        progressRef,

        effectiveClip,
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
        mergedSrcs,
        videoIsHEVC,
        userHasHEVC,
        externalTime,
        onTimeUpdate,
    });

    return (
        <div className="video-wrapper">
            <div className="video-frame">
                <video
                    ref={videoRef}
                    src={effectiveClip ? `${convertFileSrc(effectiveClip)}?v=${importToken}` : undefined}
                    poster={(externalTime === undefined) && posterPath ? `${convertFileSrc(posterPath)}?v=${importToken}` : undefined}
                    preload="metadata"
                    muted={isMuted}
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

                    <div className="time-display">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </div>

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
                            <span className="progress-bar-inner"></span>
                        </progress>
                    </div>

                    <button className="mute-btn" type="button" onClick={toggleMute}>
                        {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
                    </button>

                    <button className="fs-btn" type="button" onClick={goFullScreen}>
                        <FaExpand />
                    </button>
                </div>
            </div>
        </div>
    );
}