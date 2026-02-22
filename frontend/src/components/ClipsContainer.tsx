import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { VscLoading } from "react-icons/vsc";

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
  clips: { id: string; src: string }[];
  importToken: string;
  loading: boolean;
};

export default function ClipsContainer(props: ClipContainerProps) {
  // stores references to <video> elements keyed by clip ID.
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // index of the last selected clip
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Toggles clip in multi-selection, used for ctrl+click
  const toggleClip = (id: string) => {
    props.setSelectedClips(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Selects a single clip and clears all others
  const selectSingleClip = (id: string) => {
    props.setSelectedClips(new Set([id]));
  };

  // Selects range of clips
  const selectRange = (id: string) => {
    const currentIndex = props.clips.findIndex(c => c.id === id);
    if (lastSelectedIndex === null) return;

    const [start, end] = [lastSelectedIndex, currentIndex].sort(
      (a, b) => a - b
    );

    const range = props.clips.slice(start, end + 1).map(c => c.id);
    props.setSelectedClips(new Set(range));
  };

  useEffect(() => {
    Object.values(videoRefs.current).forEach(video => {
      if (!video) return;

      if (props.gridPreview) {
        video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    });
  }, [props.gridPreview]);
  // --------------------
  // Render
  // --------------------

  return (
    <main className="clips-container">
        <div
        ref={props.gridRef}
          className="clips-grid"
          style={{
            gridTemplateColumns: `repeat(${props.cols}, minmax(0, 1fr))`
          }}
        >
        { props.loading 
          ? Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="clip-skeleton" />
          ))
          : props.clips.map((clip, index) => (
          <div
            key={clip.id}
            // Apply green outline when selected
            className={`clip-wrapper ${
              props.selectedClips.has(clip.id) ? "selected" : ""
            }`}
          >
            {/* 
              Video clip cell:
              - Autoplays on hover
              - Supports single / multi / range selection
              - Updates preview on click
            */}
            <video
              className="clip"
              // convertFileSrc converts it to an http which makes it accessible
              src={`${convertFileSrc(clip.src)}?v=${props.importToken}`}
              muted
              loop
              preload="metadata"

              // Store reference for hover playback control
              ref={(el) => {
                videoRefs.current[clip.id] = el;
              }}
              
              // Hover preview playback
              
              // if gridPreview == true, play all, else play on hover
              onMouseEnter={() => {
                if (!props.gridPreview) {
                  videoRefs.current[clip.id]?.play();
                }
              }}

              onMouseLeave={() => {
                if (!props.gridPreview) {
                  const v = videoRefs.current[clip.id];
                  if (v) {
                    v.pause();
                    v.currentTime = 0;
                  }
                }
              }}

              // Click behavior with modifier keys
              onClick={(e) => {
                const isCtrl = e.ctrlKey || e.metaKey;
                const isShift = e.shiftKey;

                if (isShift && lastSelectedIndex !== null) {
                  // Shift + Click → range select
                  selectRange(clip.id);
                } 
                else if (isCtrl) {
                  // Ctrl / Cmd + Click → toggle selection
                  toggleClip(clip.id);
                  props.onSelectClip(clip.src); // update preview
                } 
                else {
                  // Normal click → single select + preview
                  selectSingleClip(clip.id);
                  props.onSelectClip(clip.src);
                }

                // Update anchor for future Shift selections
                if (!isShift) {
                  setLastSelectedIndex(index);
                }
              }}
            />
          </div>
        ))}

      </div>
    </main>
  );
}
