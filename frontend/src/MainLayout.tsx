import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClipsContainer from "./components/clipsGrid/ClipsContainer";
import PreviewContainer from "./components/previewPanel/PreviewContainer";
import { useAppStateStore } from "./stores/appStore";

export default function MainLayout({ intro = false }: { intro?: boolean }) {
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
                <div
                    className={`left-pane ${intro ? "app-intro" : ""}`}
                    style={{ width: `${leftWidth}%`, ...(intro ? { ["--intro-delay" as any]: "80ms" } : {}) }}
                >
                    <ClipsContainer />
                </div>

                <div className="divider" onMouseDown={startHorizontalResize}>
                    <span className="subdivider" />
                    <span className="subdivider" />
                </div>

                <div
                    className={`right-pane ${intro ? "app-intro" : ""}`}
                    style={{ width: `${100 - leftWidth}%`, ...(intro ? { ["--intro-delay" as any]: "180ms" } : {}) }}
                >
                    <PreviewContainer
                        sourceClip={focusedClip}
                        sourceClipThumbnail={focusedClipThumbnail}
                    />
                </div>
            </div>
        </div>
    )
}