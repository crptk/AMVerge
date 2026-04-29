import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import ImportButtons from "../components/ImportButtons";
import MainLayout from "../MainLayout";
import { fileNameFromPath } from "../utils/episodeUtils";
import { GeneralSettings } from "../settings/generalSettings";
import { ThemeSettings } from "../settings/themeSettings";
import { ClipItem } from "../types/domain";
import useTimeline from "../hooks/useTimeline";

interface HomePageProps {
  cols: number;
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  snapGridBigger: () => void;
  snapGridSmaller: () => void;
  setGridPreview: React.Dispatch<React.SetStateAction<boolean>>;
  gridPreview: boolean;
  selectedClips: Set<string>;
  setSelectedClips: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  onImportClick: () => void;
  loading: boolean;
  mainLayoutWrapperRef: React.RefObject<HTMLDivElement | null>;
  clips: { id: string; src: string; thumbnail: string; originalName?: string; start?: number; end?: number }[];
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  importToken: string;
  isEmpty: boolean;
  handleExport: (
    selectedClips: Set<string>,
    mergeEnabled: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  sideBarEnabled: boolean;
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  focusedClip: string | null;
  setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
  exportDir: string | null;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
  openedEpisodeId: string | null;
  importedVideoPath: string | null;
  generalSettings: GeneralSettings;
  setGeneralSettings: React.Dispatch<React.SetStateAction<GeneralSettings>>;
  onDownloadClip: (clip: ClipItem) => void;
  themeSettings: ThemeSettings;
  timelineEnabled: boolean;
  setTimelineEnabled: (val: boolean) => void;
}

export default function HomePage({
  cols,
  gridSize,
  gridRef,
  snapGridBigger,
  snapGridSmaller,
  setGridPreview,
  gridPreview,
  selectedClips,
  setSelectedClips,
  onImportClick,
  loading,
  mainLayoutWrapperRef,
  clips,
  setClips,
  importToken,
  isEmpty,
  handleExport,
  sideBarEnabled,
  videoIsHEVC,
  userHasHEVC,
  focusedClip,
  setFocusedClip,
  exportDir,
  onPickExportDir,
  onExportDirChange,
  defaultMergedName,
  openedEpisodeId,
  importedVideoPath,
  generalSettings,
  setGeneralSettings,
  onDownloadClip,
  themeSettings,
  timelineEnabled,
  setTimelineEnabled,
}: HomePageProps) {
  const isUpdatingFromTimeline = useRef(false);
  const selectedClipsRef = useRef(selectedClips);
  useEffect(() => {
    selectedClipsRef.current = selectedClips;
  }, [selectedClips]);

  const timeline = useTimeline(useCallback((segments) => {
    isUpdatingFromTimeline.current = true;
    
    setClips((prevClips) => {
      const currentSelected = selectedClipsRef.current;
      let insertIndex = prevClips.findIndex(c => currentSelected.has(c.id));
      if (insertIndex === -1) insertIndex = prevClips.length;

      const remainingClips = prevClips.filter(c => !currentSelected.has(c.id));

      const newClipsFromTimeline = segments.map(seg => {
        const baseClip = seg.sourceClip || prevClips.find(c => c.id === seg.id);

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
        ...remainingClips.slice(insertIndex)
      ];
    });

    setSelectedClips(new Set(segments.map(s => s.id)));
  }, [setClips, setSelectedClips])); // Removed selectedClips dependency

  const { state: timelineState, dispatch: dispatchTimeline } = timeline;
  const { segments } = timelineState;

  const processingIdsRef = useRef<Set<string>>(new Set());

  // Handle backend merging of segments
  useEffect(() => {
    const mergingSegments = segments.filter(s => s.isProcessing && !s.splitInfo && !processingIdsRef.current.has(s.id));
    if (mergingSegments.length === 0) return;

    mergingSegments.forEach(async (merging) => {
      processingIdsRef.current.add(merging.id);
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

    groups.forEach(async (parts, originalId) => {
      const part1 = parts.find(p => p.splitInfo?.part === 1);
      const part2 = parts.find(p => p.splitInfo?.part === 2);
      
      if (!part1 || !part2) return; 

      processingIdsRef.current.add(part1.id);
      processingIdsRef.current.add(part2.id);

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
    });
  }, [segments, dispatchTimeline]);

  // Sync clips from Grid -> Timeline
  useEffect(() => {
    if (isUpdatingFromTimeline.current) {
      isUpdatingFromTimeline.current = false;
      return;
    }

    if (clips.length > 0 && selectedClips.size > 0) {
      const selectedClipItems = clips.filter(c => selectedClips.has(c.id));
      
      let currentTrackPos = 0;
      const segments = selectedClipItems.map((clip, i) => {
        const duration = (clip.end !== undefined && clip.start !== undefined) 
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
  }, [clips, selectedClips, timeline.init]);

  return (
    <>
      <ImportButtons
        cols={cols}
        gridSize={gridSize}
        onBigger={snapGridBigger}
        onSmaller={snapGridSmaller}
        setGridPreview={setGridPreview}
        gridPreview={gridPreview}
        selectedClips={selectedClips}
        setSelectedClips={setSelectedClips}
        onImport={onImportClick}
        loading={loading}
        timelineEnabled={timelineEnabled}
        setTimelineEnabled={setTimelineEnabled}
      />

      <div className="main-layout-wrapper" ref={mainLayoutWrapperRef}>
        <MainLayout
          cols={cols}
          gridSize={gridSize}
          gridRef={gridRef}
          gridPreview={gridPreview}
          setGridPreview={setGridPreview}
          clips={clips}
          importToken={importToken}
          isEmpty={isEmpty}
          handleExport={handleExport}
          sideBarEnabled={sideBarEnabled}
          videoIsHEVC={videoIsHEVC}
          userHasHEVC={userHasHEVC}
          focusedClip={focusedClip}
          setFocusedClip={setFocusedClip}
          exportDir={exportDir}
          onPickExportDir={onPickExportDir}
          onExportDirChange={onExportDirChange}
          defaultMergedName={defaultMergedName}
          selectedClips={selectedClips}
          setSelectedClips={setSelectedClips}
          loading={loading}
          generalSettings={generalSettings}
          setGeneralSettings={setGeneralSettings}
          onDownloadClip={onDownloadClip}
          themeSettings={themeSettings}
          timeline={timeline}
          timelineEnabled={timelineEnabled}
        />

        <div className="info-bar">
          {openedEpisodeId && importedVideoPath && (
            <span className="info-bar-filename">
              {fileNameFromPath(importedVideoPath)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}