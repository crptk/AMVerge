import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

// --------------------
//     Types/Props
// --------------------

type ClipContainerProps = {
  onSelectClip: (clip: string) => void;
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  cols: number;
  gridPreview: boolean;
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedClips: Set<string>;
  clips: { id: string; src: string; thumbnail: string }[];
  importToken: string;
  loading: boolean;
  isEmpty: boolean;
};

// --------------------
//   Lazy Video Cell
// --------------------

type LazyClipProps = {
  clip: { id: string; src: string, thumbnail: string };
  importToken: string;
  isSelected: boolean;
  gridPreview: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  videoRef: (el: HTMLVideoElement | null) => void;
};

function LazyClip({ clip, importToken, isSelected, gridPreview, onClick, videoRef }: LazyClipProps) {
  // tracks whether this clip has entered the viewport at least once
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "400px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Sync gridPreview play/pause — runs when gridPreview toggles OR when the
  // clip first becomes visible (covers the case where gridPreview is already
  // true when the user scrolls a clip into view).
  useEffect(() => {
    const v = internalVideoRef.current;
    if (!v) return;
    if (gridPreview || isHovered) {
      v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [gridPreview, isHovered]);

  const showVideo = isHovered || gridPreview;

  return (
    <div
      ref={wrapperRef}
      className={`clip-wrapper ${isSelected ? "selected" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isVisible ? (
        <>
          {/* Thumbnail — always rendered when visible, hidden on hover */}
          <img
            className="clip"
            src={`${convertFileSrc(clip.thumbnail)}?v=${importToken}`}
            style={{ display: showVideo ? "none" : "block" }}
          />
          {/* Video — only mounted when hovered or gridPreview, otherwise skip the DOM node entirely */}
          {showVideo && (
            <video
              className="clip"
              src={`${convertFileSrc(clip.src)}?v=${importToken}`}
              muted
              loop
              autoPlay
              preload="none"
              ref={(el) => {
                internalVideoRef.current = el;
                videoRef(el);
              }}
            />
          )}
        </>
      ) : (
        <div className="clip clip-skeleton" style={{ borderRadius: 15 }} />
      )}
    </div>
  );
}

// --------------------
//   Main Container
// --------------------

export default function ClipsContainer(props: ClipContainerProps) {
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const toggleClip = (id: string) => {
    props.setSelectedClips(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectSingleClip = (id: string) => {
    props.setSelectedClips(new Set([id]));
  };

  const selectRange = (id: string) => {
    const currentIndex = props.clips.findIndex(c => c.id === id);
    if (lastSelectedIndex === null) return;
    const [start, end] = [lastSelectedIndex, currentIndex].sort((a, b) => a - b);
    const range = props.clips.slice(start, end + 1).map(c => c.id);
    props.setSelectedClips(new Set(range));
  };

  return (
    <main className="clips-container">
      { props.isEmpty ? (
        <p id="empty-grid">No video loaded.</p>
      ) : (
          <div
            ref={props.gridRef}
            className="clips-grid"
            style={{ gridTemplateColumns: `repeat(${props.cols}, minmax(0, 1fr))` }}
          >
            {props.loading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="clip-skeleton" />
                ))
              : props.clips.map((clip, index) => (
                  <LazyClip
                    key={clip.id}
                    clip={clip}
                    importToken={props.importToken}
                    isSelected={props.selectedClips.has(clip.id)}
                    gridPreview={props.gridPreview}
                    videoRef={(el) => { videoRefs.current[clip.id] = el; }}
                    onClick={(e) => {
                      const isCtrl = e.ctrlKey || e.metaKey;
                      const isShift = e.shiftKey;

                      if (isShift && lastSelectedIndex !== null) {
                        selectRange(clip.id);
                      } else if (isCtrl) {
                        toggleClip(clip.id);
                        props.onSelectClip(clip.src);
                      } else {
                        selectSingleClip(clip.id);
                        props.onSelectClip(clip.src);
                      }

                      if (!isShift) setLastSelectedIndex(index);
                    }}
                  />
                ))}
          </div>
       )}
    </main>
  );
}