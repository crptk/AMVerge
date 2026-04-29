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
    clipId: string; // Added to find the cache
    isPlaying: boolean;
};

export default function EditorVideoPlayer({
    selectedClip,
    videoIsHEVC,
    userHasHEVC,
    importToken,
    externalTime,
    onTimeUpdate,
    clipId,
    isPlaying,
}: EditorVideoPlayerProps) {
    const {
        videoRef,
        effectiveClip,
        handleLoadedMetadata,
        handleTimeUpdate,
        hpFilmstrip,
    } = useEditorVideoPlayer({
        selectedClip,
        videoIsHEVC,
        userHasHEVC,
        externalTime,
        onTimeUpdate,
        clipId,
        isPlaying,
    });

    // Derive current frame from externalTime
    const currentFrameUrl = React.useMemo(() => {
        if (!hpFilmstrip || !hpFilmstrip.cachePath || externalTime === undefined) return null;
        
        const { fps, frameCount, cachePath } = hpFilmstrip;
        const frameIdx = Math.max(1, Math.floor(externalTime * fps) + 1);
        const frameName = `frame_${String(frameIdx).padStart(6, '0')}.png`;
        return convertFileSrc(`${cachePath}/${frameName}`);
    }, [hpFilmstrip, externalTime]);

    return (
        <div className="editor-video-player" style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* High-precision Frame Preview (shows when paused/scrubbing) */}
            {currentFrameUrl && !isPlaying && (
                <img 
                    className="editor-frame-preview"
                    src={currentFrameUrl}
                    alt="Frame Preview"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        zIndex: 2,
                        backgroundColor: '#000',
                        display: 'block'
                    }}
                    onError={(e) => {
                        // If frame fails to load (e.g. 404), hide the preview to show the video
                        e.currentTarget.style.display = 'none';
                        const video = videoRef.current;
                        if (video) video.style.opacity = '1';
                    }}
                />
            )}

            <video
                ref={videoRef}
                src={effectiveClip ? `${convertFileSrc(effectiveClip)}?v=${importToken}` : undefined}
                preload="auto"
                muted
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain',
                    opacity: (!isPlaying && currentFrameUrl) ? 0 : 1 // Hide video when showing frame
                }}
                onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget)}
                onTimeUpdate={handleTimeUpdate}
            />
        </div>
    );
}
