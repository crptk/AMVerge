import React, { useMemo, useRef } from "react";
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
  clips,
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

  // 1. Derive the active segment metadata
  const activeSegmentRaw = useMemo(() => {
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
  }, [timelineState.segments, Math.floor(timelineState.playheadSec * 10) / 10]);

  // Use another memo to keep the OBJECT IDENTITY stable if the ID is the same
  const activeSegment = useMemo(() => activeSegmentRaw, [activeSegmentRaw?.id, activeSegmentRaw?.clipId]);

  // 2. Track the LAST valid segment to prevent unmounting in gaps
  const lastSegmentRef = useRef(activeSegment);
  
  // Only update last valid if we actually found something
  if (activeSegment) {
    lastSegmentRef.current = activeSegment;
  }

  // Only be "sticky" if the timeline isn't completely empty
  const effectiveSegment = (timelineState.segments.length > 0) 
    ? (activeSegment || lastSegmentRef.current) 
    : null;

  // 3. Derive the precise source time (changes every frame)
  const sourceTime = useMemo(() => {
    if (!effectiveSegment) return 0;
    const offset = Math.max(0, timelineState.playheadSec - effectiveSegment.start);
    return effectiveSegment.sourceStart + offset;
  }, [timelineState.playheadSec, effectiveSegment]);

  const onExportClick = () => {
    console.log("[EditorPage] Export requested for:", Array.from(timelineClipIds));
    handleExport(timelineClipIds, true, defaultMergedName);
  };

  // 4. Keyboard Shortcuts (Linked with Timeline)
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
            timeline.setPlayhead(timelineState.playheadSec + (1/30));
        }

        if (e.code === "ArrowLeft") {
            e.preventDefault();
            timeline.setPlayhead(timelineState.playheadSec - (1/30));
        }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timeline.togglePlayback, timeline.setPlayhead, timelineState.playheadSec]);

  // 5. Gap/Master Timer (only moves if no video is currently driving the timeline)
  React.useEffect(() => {
    if (!timelineState.isPlaying || activeSegment) return;

    let lastTime = performance.now();
    let rafId: number;

    const tick = (now: number) => {
        const delta = (now - lastTime) / 1000;
        lastTime = now;
        timeline.setPlayhead(timelineState.playheadSec + delta);
        rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [timelineState.isPlaying, !!activeSegment, timelineState.playheadSec]);

  return (
    <div className="editor-page-root">
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
      <main className="editor-viewport">
        <div className="editor-preview-container">
          {effectiveSegment ? (
            <div className="editor-video-wrapper">
                <EditorVideoPlayer
                    key={`editor-player-${effectiveSegment.src}`}
                    selectedClip={effectiveSegment.src}
                    clipId={effectiveSegment.clipId}
                    videoIsHEVC={videoIsHEVC}
                    userHasHEVC={userHasHEVC}
                    importToken={importToken}
                    externalTime={sourceTime}
                    isPlaying={timelineState.isPlaying}
                    onTimeUpdate={(time) => {
                        const { segments, playheadSec } = timelineState;
                        const seg = segments.find(s => s.id === effectiveSegment.id);
                        if (seg) {
                            const offset = time - (seg.sourceStart ?? 0);
                            const newPlayheadSec = seg.start + offset;
                            
                            if (Math.abs(playheadSec - newPlayheadSec) > 0.001) {
                                timeline.setPlayhead(newPlayheadSec);
                            }
                        }
                    }}
                />
            </div>
          ) : (
            <div className="editor-preview-empty">
              <p>Add clips to the timeline to begin editing</p>
            </div>
          )}
        </div>
      </main>

      {/* ── Timeline Area ── */}
      <footer className="editor-timeline-area">
        <TimelineTrack timeline={timeline} trackHeight={220} />
      </footer>
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
