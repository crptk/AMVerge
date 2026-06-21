/**
 * VideoPlayer.tsx
 *
 * Custom-skinned preview player. Renders the markup the existing preview CSS
 * targets (.video-wrapper > .video-frame > video + .controls) so the default
 * browser controls are replaced by the app's play/pause, scrubber, time,
 * volume and fullscreen chrome.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FaPlay, FaPause, FaVolumeUp, FaVolumeMute, FaExpand } from "react-icons/fa";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type VideoPlayerProps = {
  src: string;
  volume: number;
  onTimeUpdate?: (time: number) => void;
};

export default function VideoPlayer({ src, volume, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Keep the element volume in sync with the app setting.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = volume;
  }, [volume, src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !isFinite(duration) || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v.currentTime = fraction * duration;
  }, [duration]);

  return (
    <div className="video-wrapper">
      <div className="video-frame" ref={frameRef}>
        <video
          ref={videoRef}
          src={src}
          autoPlay
          playsInline
          onClick={togglePlay}
          onLoadedMetadata={(e) => {
            e.currentTarget.volume = volume;
            setDuration(e.currentTarget.duration);
            setMuted(e.currentTarget.muted);
          }}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onTimeUpdate={(e) => {
            setCurrent(e.currentTarget.currentTime);
            onTimeUpdate?.(e.currentTarget.currentTime);
          }}
        />
        <div className="controls">
          <button onClick={togglePlay} title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <FaPause /> : <FaPlay />}
          </button>

          <span className="time-display">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <div className="progress" onClick={handleSeek}>
            <progress value={current} max={duration > 0 ? duration : 1} />
          </div>

          <button onClick={toggleMute} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <FaVolumeMute /> : <FaVolumeUp />}
          </button>

          <button onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
            <FaExpand />
          </button>
        </div>
      </div>
    </div>
  );
}
