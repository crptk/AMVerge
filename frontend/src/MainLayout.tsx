import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClipsContainer from "./components/clipsGrid/ClipsContainer";
import PreviewContainer from "./components/previewPanel/PreviewContainer";
import type { UseTimelineReturn } from "./hooks/useTimeline";
import { useAppStateStore } from "./stores/appStore";

type LayoutProps = {
    timeline: UseTimelineReturn;
    timelineEnabled: boolean;
};

export default function MainLayout(props: LayoutProps) {
    const [leftWidth, setLeftWidth] = useState(65);
    const focusedClipId = useAppStateStore(s => s.focusedClip);
    const clips = useAppStateStore(s => s.clips);

    const focusedClipItem = useMemo(
        () => (focusedClipId ? clips.find((clip) => clip.id === focusedClipId) ?? null : null),
        [focusedClipId, clips]
    );

    const focusedClipThumbnail = focusedClipItem?.thumbnail ?? null;

    // ── Timeline-Preview Link ────────────────────────────────────────
    const activeTimelineSource = useMemo(() => {
        const { segments, playheadSec } = props.timeline.state;
        const seg = segments.find(s => playheadSec >= s.start && playheadSec < s.end);
        if (!seg || !seg.sourceClip) return null;

        const offset = playheadSec - seg.start;
        const sourceTime = (seg.sourceStart ?? 0) + offset;

        return {
            id: seg.id,
            src: seg.sourceClip.src,
            time: sourceTime,
            thumbnail: seg.sourceClip.thumbnail,
            mergedSrcs:
                seg.sourceClip.mergedSrcs ??
                (seg.sourceClips && seg.sourceClips.length > 1
                    ? seg.sourceClips.map((clip) => clip.src)
                    : undefined),
        };
    }, [props.timeline.state.playheadSec, props.timeline.state.segments]);

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
    }, [setLeftWidth]);

    return (
        <div className="main-layout-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            <div className="split-layout" style={{ flex: 1, minHeight: 0 }}>
                <div className="left-pane" style={{ width: `${leftWidth}%` }}>
                    <ClipsContainer />
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
                        sourceClip={focusedClipItem?.src ?? null}
                        sourceClipThumbnail={focusedClipThumbnail}
                        onTimeUpdate={(time) => {
                            if (!props.timelineEnabled) return;
                            const { segments, playheadSec } = props.timeline.state;

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
