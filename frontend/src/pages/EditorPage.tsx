import React, { useMemo, useRef, useCallback } from "react";
import EditorVideoPlayer from "../components/previewPanel/videoPlayer/EditorVideoPlayer";
import TimelineTrack from "../components/timeline/TimelineTrack";
import type { UseTimelineReturn } from "../hooks/useTimeline";
import { fileNameFromPath } from "../utils/episodeUtils";
import { FaRocket, FaChevronLeft, FaClock, FaDiscord } from "react-icons/fa";
import { useAppStateStore } from "../stores/appStore";
import { useUIStateStore } from "../stores/UIStore";
import useImportExport from "../hooks/useImportExport";
import "../styles/home/editor.css";

type EditorPageProps = {
  timeline: UseTimelineReturn;
};

export default function EditorPage({
  timeline,
}: EditorPageProps) {
  const { state: timelineState } = timeline;
  const clips = useAppStateStore((state) => state.clips);
  const importedVideoPath = useAppStateStore((state) => state.importedVideoPath);
  const timelineClipIds = useAppStateStore((state) => state.timelineClipIds);
  const setActiveMode = useUIStateStore((state) => state.setActiveMode);
  const { handleExport } = useImportExport();

  const defaultMergedName = (clips[0]?.originalName || "episode") + "_merged";
  const onBackToSelector = () => setActiveMode("selector");

  const activeSegment = useMemo(() => {
    const { segments, playheadSec } = timelineState;
    // 1. Try a strict match first (exactly inside the segment)
    let seg = segments.find(s => playheadSec >= s.start && playheadSec < s.end);
    
    // 2. Fallback to a loose match (small tolerance for scrubbing/rounding)
    if (!seg) {
      seg = segments.find(s => playheadSec >= s.start - 0.01 && playheadSec < s.end + 0.01);
    }
    
    if (!seg || !seg.sourceClip) return null;

    let sourceStart = seg.sourceStart ?? 0;

    // HEALING: If the source is a Precut/Split file (local generated clip) 
    // but has a large offset that doesn't match the clip metadata, reset it.
    const src = seg.sourceClip?.src || "";
    const isSplitFile = 
        src.includes("Precut") || 
        src.includes("split") || 
        src.includes("_part") || 
        src.includes("\\episodes\\") ||
        src.includes("/episodes/");
    
    if (isSplitFile && sourceStart > 0.001) { 
        sourceStart = 0;
    }

    return {
      id: seg.id,
      clipId: seg.sourceClip.id,
      src: seg.sourceClip.src,
      mergedSrcs:
        seg.sourceClip.mergedSrcs ??
        (seg.sourceClips && seg.sourceClips.length > 1
          ? seg.sourceClips.map((clip) => clip.src)
          : undefined),
      thumbnail: seg.sourceClip.thumbnail,
      start: seg.start,
      end: seg.end,
      sourceStart: sourceStart
    };
  }, [timelineState.segments, timelineState.playheadSec]);

  const lastSegmentRef = useRef(activeSegment);
  if (activeSegment) {
    lastSegmentRef.current = activeSegment;
  }

  const effectiveSegment = (timelineState.segments.length > 0)
    ? (activeSegment || lastSegmentRef.current)
    : null;

  const sourceTime = useMemo(() => {
    if (!effectiveSegment) return 0;
    const offset = Math.max(0, timelineState.playheadSec - effectiveSegment.start);
    const time = effectiveSegment.sourceStart + offset;
    return time;
  }, [timelineState.playheadSec, timelineState.isDraggingPlayhead, effectiveSegment?.id, effectiveSegment?.start, effectiveSegment?.sourceStart]);

  const onExportClick = () => {
    handleExport(timelineClipIds, true, defaultMergedName);
  };

  const playheadRef = useRef(timelineState.playheadSec);
  playheadRef.current = timelineState.playheadSec;

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            (e.target as HTMLElement)?.isContentEditable
        ) {
            return;
        }

        if (e.repeat) return;

        if (e.code === "Space") {
            e.preventDefault();
            timeline.togglePlayback();
        }

        const FRAME_TIME = 1/30;

        if (e.code === "ArrowRight" || e.code === "Period") {
            e.preventDefault();
            // Use Shift for 10-frame jumps, or Ctrl+Period for users without arrows
            const step = e.shiftKey ? FRAME_TIME * 10 : FRAME_TIME;
            timeline.setPlayhead(playheadRef.current + step);
        }

        if (e.code === "ArrowLeft" || e.code === "Comma") {
            e.preventDefault();
            // Use Shift for 10-frame jumps, or Ctrl+Comma for users without arrows
            const step = e.shiftKey ? FRAME_TIME * 10 : FRAME_TIME;
            timeline.setPlayhead(playheadRef.current - step);
        }

        if (e.code === "KeyS") {
            e.preventDefault();
            timeline.splitAtPlayhead();
        }

        if (e.code === "KeyM") {
            e.preventDefault();
            timeline.mergeSelected();
        }

        if (e.code === "Delete" || e.code === "Backspace") {
            // Only trigger if we aren't typing in an input
            timeline.deleteSelected();
        }

        if (e.code === "Escape") {
            timeline.deselectAll();
        }

        if (e.ctrlKey && e.code === "KeyA") {
            e.preventDefault();
            timeline.selectAll();
        }

        if (e.ctrlKey && e.code === "KeyZ") {
            e.preventDefault();
            timeline.undo();
        }

        if (e.ctrlKey && (e.code === "KeyY" || (e.shiftKey && e.code === "KeyZ"))) {
            e.preventDefault();
            timeline.redo();
        }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    timeline.togglePlayback, 
    timeline.setPlayhead, 
    timeline.splitAtPlayhead, 
    timeline.mergeSelected, 
    timeline.deleteSelected,
    timeline.deselectAll,
    timeline.selectAll,
    timeline.undo,
    timeline.redo
  ]);

  /**
   * Synchronizes the timeline playhead when the video naturally plays forward.
   * This ensures the playhead follows the video frame-accurately.
   */
  const handleTimeUpdate = useCallback((time: number, isEnded?: boolean) => {
    if (effectiveSegment) {
        const offset = time - (effectiveSegment.sourceStart ?? 0);
        let newPlayheadSec = effectiveSegment.start + offset;
        
        if (isEnded && timelineState.isPlaying) {
            newPlayheadSec = effectiveSegment.end + 0.01;
        }

        if (Math.abs(playheadRef.current - newPlayheadSec) > 0.01) {
            timeline.setPlayhead(newPlayheadSec);
        }
    }
  }, [effectiveSegment, timelineState.isPlaying, timeline.setPlayhead]);

  const [timelineHeight, setTimelineHeight] = React.useState(() => {
    const saved = localStorage.getItem("amverge_editor_timeline_height");
    return saved ? parseInt(saved, 10) : 300;
  });
  const [activeResizer, setActiveResizer] = React.useState<"timeline" | null>(null);

  const onResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setActiveResizer("timeline");
  };

  React.useEffect(() => {
    if (!activeResizer) return;

    const onMouseMove = (e: MouseEvent) => {
      const newHeight = Math.max(150, Math.min(600, window.innerHeight - e.clientY));
      setTimelineHeight(newHeight);
    };

    const onMouseUp = () => {
      setActiveResizer(null);
      localStorage.setItem("amverge_editor_timeline_height", timelineHeight.toString());
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [activeResizer, timelineHeight]);

  return (
    <div className={`editor-page-root ${activeResizer ? 'is-resizing' : ''}`}>
      {/* ── Header ── */}
      <header className="editor-header">
        <button className="editor-back-btn" onClick={onBackToSelector}>
          <FaChevronLeft />
          <span>Selector</span>
        </button>
        <div className="editor-title">
          <span className="editor-filename">
            {importedVideoPath ? fileNameFromPath(importedVideoPath) : "Untitled Project"}
            <span className="beta-badge">Beta</span>
          </span>
          <div className="discord-contact">
             <FaClock style={{ opacity: 0.6 }} />
             <span style={{ marginRight: '8px' }}>{formatTimecode(timelineState.playheadSec)}</span>
             <FaDiscord style={{ opacity: 0.6 }} />
             <span>Found a bug? Contact us on Discord</span>
          </div>
        </div>
        <div className="editor-header-actions">
           <button className="editor-export-btn" onClick={onExportClick}>
              <FaRocket />
              <span>Export</span>
           </button>
        </div>
      </header>

      {/* ── Main View Area ── */}
      <main className="editor-main-layout">
        <section className="editor-viewport">
          <div className="editor-preview-container">
            {effectiveSegment ? (
              <div className="editor-video-wrapper">
                  <EditorVideoPlayer
                      key={`editor-player-${effectiveSegment.src}`}
                      selectedClip={effectiveSegment.src}
                      mergedSrcs={effectiveSegment.mergedSrcs}
                      externalTime={sourceTime}
                      isPlaying={timelineState.isPlaying}
                      isDragging={timelineState.isDraggingPlayhead}
                      onTimeUpdate={handleTimeUpdate}
                  />
              </div>
            ) : (
              <div className="editor-preview-empty">
                <p>Add clips to the timeline to begin editing</p>
              </div>
            )}
          </div>
        </section>

        {/* Vertical Resizer */}
        <div 
          className="editor-resizer-h" 
          onMouseDown={onResizerMouseDown}
        />

        {/* Timeline Area */}
        <footer 
          className="editor-timeline-area" 
          style={{ height: `${timelineHeight}px` }}
        >
          <TimelineTrack timeline={timeline} trackHeight={timelineHeight - 80} />
        </footer>
      </main>
    </div>
  );
}

function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
