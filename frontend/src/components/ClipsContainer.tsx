import Thumb from "../assets/thumb_test.png";
import clip1 from "../assets/clip1.mp4";
import clip2 from "../assets/clip2.mp4";
import clip3 from "../assets/clip3.mp4";
import clip4 from "../assets/clip4.mp4";
import clip5 from "../assets/clip5.mp4";
import clip6 from "../assets/clip6.mp4";
import clip7 from "../assets/clip7.mp4";
import clip8 from "../assets/clip8.mp4";
import clip9 from "../assets/clip9.mp4";
import { useState, useRef, useEffect } from "react";
// --------------------
//     Types/Props
// --------------------

// defines a clip object
type Clip = {
  id: string;
  src: string;
};

// list of clips
const clips: Clip[] = [
  { id: "1", src: clip1 },
  { id: "2", src: clip2 },
  { id: "3", src: clip3 },
  { id: "4", src: clip4 },
  { id: "5", src: clip5 },
  { id: "6", src: clip6 },
  { id: "7", src: clip7 },
  { id: "8", src: clip8 },
  { id: "9", src: clip9 },
];

// called whenever a clip should be previewed
type ClipContainerProps = {
  onSelectClip: (clip: string) => void;
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  cols: number;
  gridPreview: boolean;
  setSelectedClips: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  selectedClips: Set<string>;
};

// --------------------
//      Component
// --------------------

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
    const currentIndex = clips.findIndex(c => c.id === id);
    if (lastSelectedIndex === null) return;

    const [start, end] = [lastSelectedIndex, currentIndex].sort(
      (a, b) => a - b
    );

    const range = clips.slice(start, end + 1).map(c => c.id);
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
          
        {clips.map((clip, index) => (
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
              src={clip.src}
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
