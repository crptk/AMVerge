import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorVideoPlayer } from "./useEditorVideoPlayer";

type EditorVideoPlayerProps = {
    selectedClip: string;
    videoIsHEVC: boolean | null;
    userHasHEVC: React.RefObject<boolean>;
    importToken: string;
    externalTime?: number;
    onTimeUpdate?: (time: number) => void;
    isPlaying: boolean;
    isDragging: boolean;
};

export default function EditorVideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
    importToken,
    externalTime,
    onTimeUpdate,
    isPlaying,
    isDragging,
}: EditorVideoPlayerProps) {
    const {
        videoRef,
        effectiveClip,
        handleLoadedMetadata,
        handleVideoError,
        handleTimeUpdate,
    } = useEditorVideoPlayer({
        selectedClip,
        videoIsHEVC,
        userHasHEVC,
        externalTime,
        onTimeUpdate,
        isPlaying,
        isDragging,
    });

    return (
        <div className="editor-video-player" style={{ position: 'relative', width: '100%', height: '100%' }}>
            <video
                ref={videoRef}
                src={effectiveClip ? `${convertFileSrc(effectiveClip)}?v=${importToken}` : undefined}
                preload="auto"
                muted
                playsInline
                disableRemotePlayback
                crossOrigin="anonymous"
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain',
                    opacity: 1 
                }}
                onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget)}
                onTimeUpdate={() => handleTimeUpdate(false)}
                onEnded={() => handleTimeUpdate(true)}
                onError={handleVideoError}
            />
        </div>
    );
}
