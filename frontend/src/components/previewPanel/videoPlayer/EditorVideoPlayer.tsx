import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorVideoPlayer } from "./useEditorVideoPlayer";
import { useAppStateStore } from "../../../stores/appStore";

type EditorVideoPlayerProps = {
    selectedClip: string;
    mergedSrcs?: string[];
    externalTime?: number;
    onTimeUpdate?: (time: number, isEnded?: boolean) => void;
    isPlaying: boolean;
    isDragging: boolean;
};

export default function EditorVideoPlayer({
    selectedClip,
    mergedSrcs,
    externalTime,
    onTimeUpdate,
    isPlaying,
    isDragging,
}: EditorVideoPlayerProps) {
    const importToken = useAppStateStore((state) => state.importToken);

    const {
        videoRef,
        effectiveClip,
        handleLoadedMetadata,
        handleVideoError,
        handleTimeUpdate: hookHandleTimeUpdate,
    } = useEditorVideoPlayer({
        selectedClip,
        mergedSrcs,
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
                onTimeUpdate={() => hookHandleTimeUpdate(false)}
                onEnded={() => hookHandleTimeUpdate(true)}
                onError={handleVideoError}
            />
        </div>
    );
}
