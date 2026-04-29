import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClipsContainer from "./components/clipsGrid/ClipsContainer";
import PreviewContainer from "./components/previewPanel/PreviewContainer";
import TimelineTrack from "./components/timeline/TimelineTrack";
import type { UseTimelineReturn } from "./hooks/useTimeline";
import type { ClipItem } from "./types/domain";
import type { GeneralSettings } from "./settings/generalSettings";
import type { ThemeSettings } from "./settings/themeSettings";

type LayoutProps = {
    cols: number;
    gridSize: number;
    gridRef: React.RefObject<HTMLDivElement | null>;
    gridPreview: boolean;
    setGridPreview: React.Dispatch<React.SetStateAction<boolean>>;
    clips: ClipItem[];
    importToken: string;
    isEmpty: boolean;
    handleExport: (
        selectedClips: Set<string>,
        enableMerged: boolean,
        mergeFileName?: string
    ) => Promise<void>;
    sideBarEnabled: boolean;
    videoIsHEVC: boolean | null;
    userHasHEVC: React.RefObject<boolean>;
    focusedClip: string | null;
    setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
    selectedClips: Set<string>;
    setSelectedClips: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    timelineClipIds: Set<string>;
    setTimelineClipIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    loading: boolean;
    exportDir: string | null;
    onPickExportDir: () => void;
    onExportDirChange: (dir: string) => void;
    defaultMergedName: string;
    generalSettings: GeneralSettings;
    setGeneralSettings: React.Dispatch<React.SetStateAction<GeneralSettings>>;
    onDownloadClip: (clip: ClipItem) => void;
    themeSettings: ThemeSettings;
    timeline: UseTimelineReturn;
    timelineEnabled: boolean;
};

export default function MainLayout(props: LayoutProps) {
    const [leftWidth, setLeftWidth] = useState(65);
    const [timelineHeight, setTimelineHeight] = useState(200);

    const focusedClipThumbnail = useMemo(
        () =>
            props.focusedClip
                ? props.clips.find((c) => c.src === props.focusedClip)?.thumbnail ?? null
                : null,
        [props.focusedClip, props.clips]
    );

    // ── Timeline-Preview Link ────────────────────────────────────────
    const activeTimelineSource = useMemo(() => {
        if (!props.timelineEnabled) return null;
        const { segments, playheadSec } = props.timeline.state;
        // Find segment under playhead
        const seg = segments.find(s => playheadSec >= s.start && playheadSec < s.end);
        if (!seg || !seg.sourceClip) return null;

        const offset = playheadSec - seg.start;
        const sourceTime = (seg.sourceStart ?? 0) + offset;

        return {
            src: seg.sourceClip.src,
            time: sourceTime,
            thumbnail: seg.sourceClip.thumbnail
        };
    }, [props.timelineEnabled, props.timeline.state.playheadSec, props.timeline.state.segments]);

    const resizeCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.();
        };
    }, []);

    const startHorizontalResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const startX = e.clientX;
        const container = e.currentTarget.parentElement as HTMLElement;
        const leftPane = container.children[0] as HTMLElement;
        const startLeftWidth = leftPane.offsetWidth;
        const totalWidth = container.offsetWidth;

        const onMouseMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const newPercent = ((startLeftWidth + delta) / totalWidth) * 100;
            setLeftWidth(Math.min(85, Math.max(15, newPercent)));
        };

        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            resizeCleanupRef.current = null;
        };

        resizeCleanupRef.current?.();
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        resizeCleanupRef.current = onMouseUp;
    }, []);

    const startVerticalResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const startY = e.clientY;
        const startHeight = timelineHeight;

        const onMouseMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY;
            setTimelineHeight(Math.min(500, Math.max(150, startHeight + delta)));
        };

        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }, [timelineHeight]);

    return (
        <div className="main-layout-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            <div className="split-layout" style={{ flex: 1, minHeight: 0 }}>
                <div className="left-pane" style={{ width: `${leftWidth}%` }}>
                    <ClipsContainer
                        gridSize={props.gridSize}
                        gridRef={props.gridRef}
                        cols={props.cols}
                        gridPreview={props.gridPreview}
                        selectedClips={props.selectedClips}
                        setSelectedClips={props.setSelectedClips}
                        timelineClipIds={props.timelineClipIds}
                        setTimelineClipIds={props.setTimelineClipIds}
                        clips={props.clips}
                        importToken={props.importToken}
                        loading={props.loading}
                        isEmpty={props.isEmpty}
                        videoIsHEVC={props.videoIsHEVC}
                        userHasHEVC={props.userHasHEVC}
                        setFocusedClip={props.setFocusedClip}
                        focusedClip={props.focusedClip}
                        generalSettings={props.generalSettings}
                        onDownloadClip={props.onDownloadClip}
                        themeSettings={props.themeSettings}
                    />
                </div>

                <div className="divider" onMouseDown={startHorizontalResize}>
                    <span className="subdivider" />
                    <span className="subdivider" />
                </div>

                <div className="right-pane" style={{ width: `${100 - leftWidth}%` }}>
                    <PreviewContainer
                        programClip={activeTimelineSource?.src ?? null}
                        programClipThumbnail={activeTimelineSource?.thumbnail ?? null}
                        programTime={activeTimelineSource?.time}
                        sourceClip={props.focusedClip}
                        sourceClipThumbnail={focusedClipThumbnail}
                        selectedClips={props.selectedClips}
                        timelineClipIds={props.timelineClipIds}
                        handleExport={props.handleExport}
                        videoIsHEVC={props.videoIsHEVC}
                        userHasHEVC={props.userHasHEVC}
                        importToken={props.importToken}
                        exportDir={props.exportDir}
                        onPickExportDir={props.onPickExportDir}
                        onExportDirChange={props.onExportDirChange}
                        defaultMergedName={props.defaultMergedName}
                        generalSettings={props.generalSettings}
                        setGeneralSettings={props.setGeneralSettings}
                        onTimeUpdate={(time) => {
                            if (!props.timelineEnabled) return;
                            const { segments, playheadSec } = props.timeline.state;

                            // Find the segment that matches the current video source and is close to the playhead
                            // This is more robust than just checking playheadSec
                            const seg = segments.find(s => 
                                s.sourceClip?.src === props.focusedClip || // Check if it's the focused one (Source)
                                s.sourceClip?.src === activeTimelineSource?.src // Or the active timeline one (Program)
                            );

                            if (seg) {
                                // Calculate where the playhead SHOULD be based on this segment's position
                                // time is the current time in the source file
                                const offset = time - (seg.sourceStart ?? 0);
                                const newPlayheadSec = seg.start + offset;

                                // Avoid infinite feedback loop by checking difference
                                if (Math.abs(playheadSec - newPlayheadSec) > 0.01) {
                                    props.timeline.setPlayhead(newPlayheadSec);
                                }
                            }
                        }}
                    />
                </div>
            </div>

            {/* Vertical Resize Handle for Timeline */}
            {props.timelineEnabled && (
                <>
                    <div 
                        className="timeline-v-divider" 
                        onMouseDown={startVerticalResize}
                        style={{ 
                            height: '4px', 
                            cursor: 'ns-resize', 
                            background: 'rgba(255,255,255,0.05)',
                            borderTop: '1px solid rgba(255,255,255,0.1)',
                            zIndex: 10
                        }}
                    />

                    <div className="timeline-container" style={{ height: `${timelineHeight}px`, flexShrink: 0 }}>
                        <TimelineTrack timeline={props.timeline} trackHeight={timelineHeight - 80} />
                    </div>
                </>
            )}
        </div>
    )
}