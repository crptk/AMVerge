import React, { useMemo, useRef, useCallback } from "react";
import EditorVideoPlayer from "../components/previewPanel/videoPlayer/EditorVideoPlayer";
import TimelineTrack from "../components/timeline/TimelineTrack";
import type { UseTimelineReturn } from "../hooks/useTimeline";
import type { ClipItem } from "../types/domain";
import { fileNameFromPath } from "../utils/episodeUtils";
import { FaRocket, FaChevronLeft, FaClock } from "react-icons/fa";
import "../styles/home/editor.css";

type EditorPageProps = {
  timeline: UseTimelineReturn;
  clips: ClipItem[];
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  importToken: string;
  importedVideoPath: string | null;
  onBackToSelector: () => void;
  handleExport: (
    selectedClips: Set<string>,
    enableMerged: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  timelineClipIds: Set<string>;
  defaultMergedName: string;
};

export default function EditorPage({
  timeline,
  clips: _clips,
  videoIsHEVC,
  userHasHEVC,
  importToken,
  importedVideoPath,
  onBackToSelector,
  handleExport,
  timelineClipIds,
  defaultMergedName,
}: EditorPageProps) {
  const { state: timelineState } = timeline;

  // 1. Derive the active segment — find which segment the playhead is over.
  //    We memo on segments + a coarsened playhead (for segment lookup only).
  const activeSegment = useMemo(() => {
    const { segments, playheadSec } = timelineState;
    const seg = segments.find(s => playheadSec >= s.start - 0.005 && playheadSec < s.end + 0.005);
    if (!seg || !seg.sourceClip) return null;

    return {
      id: seg.id,
      clipId: seg.sourceClip.id,
      src: seg.sourceClip.src,
      thumbnail: seg.sourceClip.thumbnail,
      start: seg.start,
      sourceStart: seg.sourceStart ?? 0
    };
  }, [timelineState.segments, timelineState.playheadSec]);

  // 2. Track the LAST valid segment to prevent unmounting in gaps
  const lastSegmentRef = useRef(activeSegment);
  if (activeSegment) {
    lastSegmentRef.current = activeSegment;
  }

  const effectiveSegment = (timelineState.segments.length > 0)
    ? (activeSegment || lastSegmentRef.current)
    : null;

  // 3. Derive the precise source time — recalculates on EVERY playhead change
  //    This is the key fix: sourceTime must update every frame, not just on segment change.
  const sourceTime = useMemo(() => {
    if (!effectiveSegment) return 0;
    const offset = Math.max(0, timelineState.playheadSec - effectiveSegment.start);
    return effectiveSegment.sourceStart + offset;
  }, [timelineState.playheadSec, effectiveSegment?.id, effectiveSegment?.start, effectiveSegment?.sourceStart]);

  const onExportClick = () => {
    console.log("[EditorPage] Export requested for:", Array.from(timelineClipIds));
    handleExport(timelineClipIds, true, defaultMergedName);
  };

  // 4. Keyboard Shortcuts — use a ref for playheadSec to keep effect stable
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

        if (e.code === "Space") {
            e.preventDefault();
            timeline.togglePlayback();
        }

        if (e.code === "ArrowRight") {
            e.preventDefault();
            timeline.setPlayhead(playheadRef.current + (1/30));
        }

        if (e.code === "ArrowLeft") {
            e.preventDefault();
            timeline.setPlayhead(playheadRef.current - (1/30));
        }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timeline.togglePlayback, timeline.setPlayhead]);

  const handleTimeUpdate = useCallback((time: number) => {
    if (!effectiveSegment) return;
    const { segments } = timelineState;
    const seg = segments.find(s => s.id === effectiveSegment.id);
    if (seg) {
        const offset = time - (seg.sourceStart ?? 0);
        const newPlayheadSec = seg.start + offset;
        
        if (Math.abs(playheadRef.current - newPlayheadSec) > 0.01) {
            timeline.setPlayhead(newPlayheadSec);
        }
    }
  }, [effectiveSegment?.id, timelineState.segments, timeline.setPlayhead]);

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
          </span>
          <div className="editor-status-badge">
            <FaClock />
            <span>{formatTimecode(timelineState.playheadSec)}</span>
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
                      videoIsHEVC={videoIsHEVC}
                      userHasHEVC={userHasHEVC}
                      importToken={importToken}
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
