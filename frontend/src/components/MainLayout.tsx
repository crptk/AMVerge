import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ClipsContainer from "./clipsGrid/ClipsContainer.tsx";
import PreviewContainer from "./previewPanel/PreviewContainer.tsx";
import { ClipItem } from "../types/domain";
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
    }, []);
    return (
        <div className="split-layout">
            <div className="left-pane" style={{ width: `${leftWidth}%`}}>
                <ClipsContainer 
                    gridRef={props.gridRef}
                    isEmpty={props.isEmpty}
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
                    focusedClipThumbnail={focusedClipThumbnail}
                    handleExport={props.handleExport}
                    userHasHEVC={props.userHasHEVC}
                    onPickExportDir={props.onPickExportDir}
                    onExportDirChange={props.onExportDirChange}
                    defaultMergedName={props.defaultMergedName}
                />
            </div>
        </div>
    )
}