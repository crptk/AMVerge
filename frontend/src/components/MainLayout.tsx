import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ClipsContainer from "./clipsGrid/ClipsContainer.tsx";
import PreviewContainer from "./previewPanel/PreviewContainer.tsx";
import { ClipItem } from "../types/domain";
import type { UseTimelineReturn } from "./hooks/useTimeline";
import { useAppStateStore } from "../store/appStore.ts";

type LayoutProps = {
    gridRef: React.RefObject<HTMLDivElement | null>;
    isEmpty: boolean;
    handleExport: (
        selectedClips: Set<string>,
        mergeEnabled: boolean,
        mergeFileName?: string
    ) => Promise<void>;
    
    userHasHEVC: React.RefObject<boolean>
    onPickExportDir: () => void;
    onExportDirChange: (dir: string) => void;
    defaultMergedName: string;
    onDownloadClip: (clip: ClipItem) => void;
};

export default function MainLayout(props: LayoutProps) {
    const [leftWidth, setLeftWidth] = useState(65);
    const focusedClip = useAppStateStore(s => s.focusedClip);
    const clips = useAppStateStore(s => s.clips);
    const focusedClipThumbnail = useMemo(
        () =>
            focusedClip
                ? clips.find((c) => c.src === focusedClip)?.thumbnail ?? null
                : null,
        [focusedClip, clips]
    );

    // ── Timeline-Preview Link ────────────────────────────────────────
    const activeTimelineSource = useMemo(() => {
        const { segments, playheadSec } = props.timeline.state;
        // Find segment under playhead
        const seg = segments.find(s => playheadSec >= s.start && playheadSec < s.end);
        if (!seg || !seg.sourceClip) return null;

        const offset = playheadSec - seg.start;
        const sourceTime = (seg.sourceStart ?? 0) + offset;

        return {
            id: seg.id, // Track the segment ID
            src: seg.sourceClip.src,
            time: sourceTime,
            thumbnail: seg.sourceClip.thumbnail
        };
    }, [props.timeline.state.playheadSec, props.timeline.state.segments]);

    // track active resize listeners so we can clean up on unmount.
    const resizeCleanupRef = useRef<(() => void) | null>(null);

    
    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.();
        };
    }, []);

    const startResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const startX = e.clientX;
        const container = e.currentTarget.parentElement as HTMLElement;
        const leftPane = container.children[0] as HTMLElement;


        const startLeftWidth = leftPane.offsetWidth;
        const totalWidth = container.offsetWidth;

        const onMouseMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const newPercent =
                ((startLeftWidth + delta) / totalWidth) * 100;
            
            setLeftWidth(Math.min(85, Math.max(15, newPercent)));
        };

        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            resizeCleanupRef.current = null;
        };

        // remove any stale listeners before attaching new ones.
        resizeCleanupRef.current?.();

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        resizeCleanupRef.current = onMouseUp;
    }, [setLeftWidth]);

    return (
        <div className="main-layout-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            <div className="split-layout" style={{ flex: 1, minHeight: 0 }}>
                <div className="left-pane" style={{ width: `${leftWidth}%`}}>
                    <ClipsContainer 
                        gridRef={props.gridRef}
                        isEmpty={props.isEmpty}
                        // PUT timelineClipids and setTimelineClipIds INTO ONE OF THE STORES 
                        timelineClipIds={props.timelineClipIds}
                        setTimelineClipIds={props.setTimelineClipIds}
                        userHasHEVC={props.userHasHEVC}
                        onDownloadClip={props.onDownloadClip}
                    />
                </div>
                
        
                <div
                    className="divider"
                    onMouseDown={(e) => startResize(e)}
                >
                    <span className="subdivider"/>

                    <span className="subdivider"/>
                </div>


                <div className="right-pane" style={{ width: `${100 - leftWidth}%` }}>
                    <PreviewContainer
                        
                        // PUT THESE ONES IN A STORE IF NOT (only of they're a state) THEN USE THEM WITHIN THE FILES ACCORDINGLY
                        programClip={activeTimelineSource?.src ?? null}
                        programClipThumbnail={activeTimelineSource?.thumbnail ?? null}
                        programTime={activeTimelineSource?.time}
                        sourceClip={props.focusedClip}
                        sourceClipThumbnail={focusedClipThumbnail}
                        selectedClips={props.selectedClips}
                        timelineClipIds={props.timelineClipIds}
                        focusedClipThumbnail={focusedClipThumbnail}


                        handleExport={props.handleExport}
                        userHasHEVC={props.userHasHEVC}
                        onPickExportDir={props.onPickExportDir}
                        onExportDirChange={props.onExportDirChange}
                        defaultMergedName={props.defaultMergedName}
                        onTimeUpdate={(time) => {
                                if (!props.timelineEnabled) return;
                                const { segments, playheadSec } = props.timeline.state;

                                // Use the specific segment ID we derived
                                const seg = segments.find(s => s.id === activeTimelineSource?.id);

                                if (seg) {
                                    const offset = time - (seg.sourceStart ?? 0);
                                    const newPlayheadSec = seg.start + offset;
                                if (Math.abs(playheadSec - newPlayheadSec) > 0.05) {
                                    props.timeline.setPlayhead(newPlayheadSec);
                                }
                            }
                        }}    
                    />
                </div>
            </div>
        </div>
    )
}