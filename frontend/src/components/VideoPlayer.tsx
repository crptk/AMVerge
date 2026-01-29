import { useRef, useState, useEffect } from "react";
import {
    FaPlay,
    FaPause,
    FaVolumeMute,
    FaVolumeUp,
    FaExpand
} from "react-icons/fa";
type VideoPlayerProps = {
  selectedClip: string;
};

export default function VideoPlayer({ selectedClip }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const wasPlayingRef = useRef(false);
    const rafRef = useRef<number | null>(null);

    // --- CONTROL HANDLERS ---
    useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        console.log(e.code);
        // Ignore typing in inputs/textareas
        if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            (e.target as HTMLElement)?.isContentEditable
        ) {
            return;
        }
        
        const video = videoRef.current;
        if (!video) return;

        if (e.code === "Space") {
            e.preventDefault(); // stops page scroll

            if (video.paused) {
                video.play();
                setIsPlaying(true);
            } else {
                video.pause();
                setIsPlaying(false);
            }
        }
        

        if (e.code === "ArrowRight") {
            e.preventDefault();
            video.currentTime = Math.min(video.duration, video.currentTime + 1);
        }

        if (e.code === "ArrowLeft") {
            e.preventDefault();
            video.currentTime = Math.min(video.duration, video.currentTime - 1);
        }

        if (e.code === "KeyF") {
            e.preventDefault();
            goFullScreen();
        }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    //--- Scrubbing Logic ---
    useEffect(() => {
        if (!isScrubbing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (rafRef.current) return;

            rafRef.current = requestAnimationFrame(() => {
            const progressEl = document.querySelector(
                ".progress"
            ) as HTMLDivElement | null;

            if (progressEl) {
                seekFromMouseEvent(e, progressEl);
            }

            rafRef.current = null;
            });
        };

        const handleMouseUp = () => {
            const video = videoRef.current;

            if (video && wasPlayingRef.current) {
            video.play();
            }

            setIsScrubbing(false);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);

            if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            }
        };
    }, [isScrubbing, duration]);


    // -- Progressbar interaction
    const seekFromMouseEvent = (
        e: MouseEvent | React.MouseEvent,
        target: HTMLDivElement
    ) => {
        if (!videoRef.current || !duration) return;

        const rect = target.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
        const percentage = x / rect.width;

        videoRef.current.currentTime = percentage * duration;
    };

    const togglePlay = () => {
        if (!videoRef.current) return;

        if (videoRef.current.paused) {
            videoRef.current.play();
            setIsPlaying(true);
        } else {
            videoRef.current.pause();
            setIsPlaying(false);
        }
    };

    const stopVideo = () => {
        if (!videoRef.current) return;

        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        setIsPlaying(false);
    };

    const toggleMute = () => {
        if (!videoRef.current) return;

        videoRef.current.muted = !videoRef.current.muted;
        setIsMuted(videoRef.current.muted);
    };

    const goFullScreen = () => {
        if (!videoRef.current) return;

        if (videoRef.current.requestFullscreen) {
            videoRef.current.requestFullscreen();
        }
    };

    return (
        <div className="video-wrapper">
            <div className="video-frame">
                <video
                    ref={videoRef}
                    src={selectedClip}
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                        const video = e.currentTarget;
                        video.style.setProperty(
                        "--aspect-ratio",
                        `${video.videoWidth} / ${video.videoHeight}`
                        );
                        setDuration(video.duration);
                        togglePlay();
                    }}
                    onTimeUpdate={() => {
                        if (!videoRef.current) return;
                        setCurrentTime(videoRef.current.currentTime);
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onClick={() => togglePlay()}
                />

                <div id="video-controls" className="controls" data-state="hidden">
                    <button type="button" onClick={togglePlay}>
                        {isPlaying ? (
                            <FaPause />
                        ) : (
                            <FaPlay />
                        )}
                    </button>

                    <div
                        className="progress"
                        onClick={(e) => {
                            if (!videoRef.current || !duration) return;

                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickX = e.clientX - rect.left;
                            const percentage = clickX / rect.width;

                            videoRef.current.currentTime = percentage * duration;
                        }}
                        onMouseDown={(e) => {
                            const video = videoRef.current;
                            if (!video) return;

                            wasPlayingRef.current = !video.paused;
                            video.pause();

                            setIsScrubbing(true);
                            seekFromMouseEvent(e, e.currentTarget);
                        }}
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
    )
}