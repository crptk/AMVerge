import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ImportButtons from "../components/ImportButtons";
import MainLayout from "../MainLayout";
import { fileNameFromPath } from "../utils/episodeUtils";
import EditorPage from "./EditorPage";

import { ClipItem } from "../types/domain";
import useTimeline from "../hooks/useTimeline";
import type { TimelineSegment } from "../types/timeline";
import { useAppStateStore } from "../stores/appStore";
import { useUIStateStore } from "../stores/UIStore";
import { useGeneralSettingsStore } from "../stores/settingsStore";
import { useEpisodePanelRuntimeStore } from "../stores/episodeStore";

interface HomePageProps {
  mainLayoutWrapperRef: React.RefObject<HTMLDivElement | null>;
  timelineEnabled: boolean;
}

export default function HomePage({
  mainLayoutWrapperRef,
  timelineEnabled,
}: HomePageProps) {
  const isUpdatingFromTimeline = useRef(false);

  const clips = useAppStateStore(s => s.clips);
  const setClips = useAppStateStore(s => s.setClips);
  const selectedClips = useAppStateStore(s => s.selectedClips);
  const timelineClipIds = useAppStateStore(s => s.timelineClipIds);
  const setTimelineClipIds = useAppStateStore(s => s.setTimelineClipIds);
  const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  const importedVideoPath = useAppStateStore(s => s.importedVideoPath);
  
  const activeMode = useUIStateStore(s => s.activeMode);
  const setActiveMode = useUIStateStore(s => s.setActiveMode);
  
  const generalSettings = useGeneralSettingsStore();

  const selectedClipsRef = useRef(selectedClips);
  useEffect(() => {
    selectedClipsRef.current = selectedClips;
  }, [selectedClips]);

  // If editor is disabled in settings, force switch back to selector mode
  useEffect(() => {
    if (!generalSettings.enableEditor && activeMode === "editor") {
      setActiveMode("selector");
    }
  }, [generalSettings.enableEditor, activeMode, setActiveMode]);


  const timelineClipIdsRef = useRef(timelineClipIds);
  useEffect(() => {
    timelineClipIdsRef.current = timelineClipIds;
  }, [timelineClipIds]);

  // Track the "version" of external clip selections to avoid re-init loops.
  const [clipSyncVersion, setClipSyncVersion] = useState(0);
  const lastSyncedVersionRef = useRef(-1);

  const timeline = useTimeline(
    useCallback(
      (segments: TimelineSegment[]) => {
        isUpdatingFromTimeline.current = true;

        setClips((prevClips) => {
          const currentInTimeline = timelineClipIdsRef.current;
          let insertIndex = prevClips.findIndex((c) => currentInTimeline.has(c.id));
          if (insertIndex === -1) insertIndex = prevClips.length;

          const remainingClips = prevClips.filter((c) => !currentInTimeline.has(c.id));

          const newClipsFromTimeline = segments.map((seg) => {
            const baseClip = seg.sourceClip || prevClips.find((c) => c.id === seg.id);

            return {
              id: seg.id,
              src: baseClip?.src || "",
              thumbnail: baseClip?.thumbnail || "",
              originalName: seg.label || baseClip?.originalName,
              start: seg.sourceStart ?? baseClip?.start ?? 0,
              end: seg.sourceEnd ?? baseClip?.end ?? 0,
            } as ClipItem;
          });

          return [
            ...remainingClips.slice(0, insertIndex),
            ...newClipsFromTimeline,
            ...remainingClips.slice(insertIndex),
          ];
        });

        setTimelineClipIds(new Set(segments.map((s: TimelineSegment) => s.id)));
      },
      [setClips, setTimelineClipIds]
    )
  );

  const { state: timelineState, dispatch: dispatchTimeline } = timeline;
  const { segments } = timelineState;

  const processingIdsRef = useRef<Set<string>>(new Set());

  // Handle backend merging of segments
  useEffect(() => {
    const mergingSegments = segments.filter(s => s.isProcessing && !s.splitInfo && !processingIdsRef.current.has(s.id));
    if (mergingSegments.length === 0) return;

    mergingSegments.forEach((merging) => {
      processingIdsRef.current.add(merging.id);
      
      (async () => {
        try {
          if (!merging.sourceClips || merging.sourceClips.length === 0) {
            throw new Error("No source clips found for merge");
          }

          const clipsToMerge = merging.sourceClips.map(c => c.src);
          const outputName = `merged_${merging.id}.mp4`;
          
          const firstClipPath = merging.sourceClip?.src || clipsToMerge[0];
          const lastSlash = Math.max(firstClipPath.lastIndexOf('\\'), firstClipPath.lastIndexOf('/'));
          const cacheDir = firstClipPath.substring(0, lastSlash);
          const outputPath = `${cacheDir}/${outputName}`;

          console.log(`[HomePage] Merging ${clipsToMerge.length} clips into: ${outputName}`);

          const newSrc = await invoke<string>("fast_merge", {
            clips: clipsToMerge,
            outputPath
          });

          dispatchTimeline({ type: "MERGE_SUCCESS", id: merging.id, newSrc });
        } catch (err) {
          console.error("[HomePage] Backend merge failed:", err);
          dispatchTimeline({ type: "MERGE_ERROR", id: merging.id });
        } finally {
          processingIdsRef.current.delete(merging.id);
        }
      })();
    });
  }, [segments, dispatchTimeline]);

  // Handle backend splitting of segments
  useEffect(() => {
    const splittingSegments = segments.filter(s => s.isProcessing && s.splitInfo && !processingIdsRef.current.has(s.id));
    if (splittingSegments.length === 0) return;

    // Group by originalId to avoid duplicate calls for the two halves of the split
    const groups = new Map<string, typeof splittingSegments>();
    splittingSegments.forEach(s => {
      const oid = s.splitInfo!.originalId;
      if (!groups.has(oid)) groups.set(oid, []);
      groups.get(oid)!.push(s);
    });

    groups.forEach((parts, _originalId) => {
      const part1 = parts.find(p => p.splitInfo?.part === 1);
      const part2 = parts.find(p => p.splitInfo?.part === 2);
      
      if (!part1 || !part2) return; 

      processingIdsRef.current.add(part1.id);
      processingIdsRef.current.add(part2.id);

      (async () => {
        try {
          const info = part1.splitInfo!;
          const inputPath = info.inputPath;
          const splitTime = info.splitTime;
          
          const lastSlash = Math.max(inputPath.lastIndexOf('\\'), inputPath.lastIndexOf('/'));
          const cacheDir = inputPath.substring(0, lastSlash);
          const fileName = inputPath.substring(lastSlash + 1);
          const stem = fileName.substring(0, fileName.lastIndexOf('.'));
          const ext = fileName.substring(fileName.lastIndexOf('.'));

          const out1 = `${cacheDir}/${stem}_part1_${part1.id}${ext}`;
          const out2 = `${cacheDir}/${stem}_part2_${part2.id}${ext}`;
          const thumb2 = `${cacheDir}/${stem}_part2_${part2.id}.jpg`;

          console.log(`[HomePage] Splitting clip at ${splitTime}s: ${fileName}`);

          await invoke("fast_split", {
            inputPath,
            splitTime,
            outputPath1: out1,
            outputPath2: out2,
            thumbPath2: thumb2
          });

          const originalDuration = (part1.sourceEnd ?? 0) - (part1.sourceStart ?? 0);
          const dur1 = splitTime;
          const dur2 = originalDuration - splitTime;

          dispatchTimeline({ type: "SPLIT_SUCCESS", id: part1.id, part: 1, newSrc: out1, newDuration: dur1 });
          dispatchTimeline({ type: "SPLIT_SUCCESS", id: part2.id, part: 2, newSrc: out2, newThumb: thumb2, newDuration: dur2 });

        } catch (err) {
          console.error("[HomePage] Backend split failed:", err);
          dispatchTimeline({ type: "SPLIT_ERROR", id: part1.id });
          dispatchTimeline({ type: "SPLIT_ERROR", id: part2.id });
        } finally {
          processingIdsRef.current.delete(part1.id);
          processingIdsRef.current.delete(part2.id);
        }
      })();
    });
  }, [segments, dispatchTimeline]);

  // Track the previous set of timeline clip IDs to detect additions in editor mode
  const prevTimelineClipIdsRef = useRef<Set<string>>(new Set());

  // Handle manual additions from sidebar in Editor Mode
  useEffect(() => {
    if (activeMode !== "editor" || isUpdatingFromTimeline.current) {
      prevTimelineClipIdsRef.current = timelineClipIds;
      return;
    }

    const prev = prevTimelineClipIdsRef.current;
    
    // Detect Additions
    if (timelineClipIds.size > prev.size) {
      const addedId = Array.from(timelineClipIds).find(id => !prev.has(id));
      if (addedId) {
        const clipToAdd = clips.find(c => c.id === addedId);
        if (clipToAdd) {
          timeline.addSegment(clipToAdd);
        }
      }
    }
    
    // Detect Deletions
    if (timelineClipIds.size < prev.size) {
      const removedId = Array.from(prev).find(id => !timelineClipIds.has(id));
      if (removedId) {
        timeline.removeSegment(removedId);
      }
    }
    
    prevTimelineClipIdsRef.current = timelineClipIds;
  }, [timelineClipIds, activeMode, clips, timeline.addSegment, timeline.removeSegment]);

  // Bump clipSyncVersion only on genuine user-driven changes (Selector Mode only)
  useEffect(() => {
    if (isUpdatingFromTimeline.current) {
      isUpdatingFromTimeline.current = false;
      return;
    }

    if (activeMode === "editor") return; // Timeline is master in editor mode
    // Skip during active import: bgProgress is non-null while thumbnails are generating.
    // Import-driven clips changes don't need timeline sync; only user-driven ones do.
    // We read from getState() directly (not as a subscription) since this is just a guard.
    if (useAppStateStore.getState().bgProgress !== null) {
      console.log("[bumpClipSyncVersion] skipped — bgProgress is active (import in progress)");
      return;
    }
    console.log("[bumpClipSyncVersion] firing — clips:", clips.length, "timelineClipIds:", timelineClipIds.size);
    setClipSyncVersion((v) => v + 1);
  }, [clips, timelineClipIds, activeMode]);

  // Sync clips from timelineClipIds -> Timeline (only on genuine version bumps)
  useEffect(() => {
    if (activeMode === "editor") return; // Don't force-init in editor mode
    if (clipSyncVersion === lastSyncedVersionRef.current) return;
    lastSyncedVersionRef.current = clipSyncVersion;

    if (clips.length > 0 && timelineClipIds.size > 0) {
      const timelineItems = clips.filter((c) => timelineClipIds.has(c.id));

      let currentTrackPos = 0;
      const segments = timelineItems.map((clip, i) => {
        const duration =
          clip.end !== undefined && clip.start !== undefined
            ? Math.max(0.1, clip.end - clip.start)
            : 5;

        const s = {
          id: clip.id,
          start: currentTrackPos,
          end: currentTrackPos + duration,
          label: clip.originalName || `Clip ${i + 1}`,
          sourceClip: clip,
        };

        currentTrackPos += duration;
        return s;
      });

      const totalDuration = segments.length > 0 ? currentTrackPos + 1 : 0;
      timeline.init(segments, totalDuration);
    } else {
      timeline.init([], 0);
    }
  }, [clipSyncVersion, clips, timelineClipIds, timeline.init, activeMode]);

  return (
    <>
      <ImportButtons />

      <div className="mode-tabs">
        <button
          className={`mode-tab ${activeMode === "selector" ? "active" : ""}`}
          onClick={() => setActiveMode("selector")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          SELECTOR
        </button>
        {generalSettings.enableEditor && (
          <button
            className={`mode-tab ${activeMode === "editor" ? "active" : ""}`}
            onClick={() => setActiveMode("editor")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12h20M2 6h20M2 18h20" />
              <rect x="6" y="4" width="2" height="16" />
            </svg>
            EDITOR
            <span className="beta-badge" style={{ fontSize: '0.6rem', padding: '1px 4px', marginLeft: '4px' }}>BETA</span>
          </button>
        )}
      </div>

      <div className="main-layout-wrapper" ref={mainLayoutWrapperRef}>
        {activeMode === "selector" ? (
          <MainLayout
            timeline={timeline}
            timelineEnabled={timelineEnabled} // Keep sync even if hidden
          />
        ) : (
          <EditorPage 
            timeline={timeline}
          />
        )}

        {activeMode === "selector" && (
          <div className="info-bar">
            {openedEpisodeId && importedVideoPath && (
              <span className="info-bar-filename">
                {fileNameFromPath(importedVideoPath)}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}