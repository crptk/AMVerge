import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { GeneralSettings } from "./settings/generalSettings";
import ClipsContainer from "./components/clipsGrid/ClipsContainer.tsx";
import PreviewContainer from "./components/previewPanel/PreviewContainer.tsx";

type LayoutProps = {
    cols: number;
    gridSize: number;
    gridRef: React.RefObject<HTMLDivElement | null>;
    gridPreview: boolean;
    setGridPreview: React.Dispatch<React.SetStateAction<boolean>>;
    selectedClips: Set<string>;
    setSelectedClips: React.Dispatch<
        React.SetStateAction<Set<string>>
    >;
    clips: { id: string; src: string; thumbnail: string }[];
    importToken: string;
    loading: boolean;
    isEmpty: boolean;
    handleExport: (
        selectedClips: Set<string>,
        mergeEnabled: boolean,
        mergeFileName?: string
    ) => Promise<void>;
    sideBarEnabled: boolean;
    videoIsHEVC: boolean | null;
    userHasHEVC: React.RefObject<boolean>
    focusedClip: string | null;
    setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>
    exportDir: string | null;
    onPickExportDir: () => void;
    onExportDirChange: (dir: string) => void;
    defaultMergedName: string;
    generalSettings: GeneralSettings;
    setGeneralSettings: React.Dispatch<React.SetStateAction<GeneralSettings>>;
};

export default function MainLayout(props: LayoutProps) {
    const [leftWidth, setLeftWidth] = useState(65);

    const focusedClipThumbnail = useMemo(
        () =>
            props.focusedClip
                ? props.clips.find((c) => c.src === props.focusedClip)?.thumbnail ?? null
                : null,
        [props.focusedClip, props.clips]
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
                    gridSize={props.gridSize}
                    gridRef={props.gridRef}
                    cols={props.cols}
                    gridPreview={props.gridPreview}
                    selectedClips={props.selectedClips}
                    setSelectedClips={props.setSelectedClips}
                    clips={props.clips}
                    importToken={props.importToken}
                    loading={props.loading}
                    isEmpty={props.isEmpty}
                    videoIsHEVC={props.videoIsHEVC}
                    userHasHEVC={props.userHasHEVC}
                    setFocusedClip={props.setFocusedClip}
                    focusedClip={props.focusedClip}
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
                    focusedClip={props.focusedClip}
                    focusedClipThumbnail={focusedClipThumbnail}
                    selectedClips={props.selectedClips}
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
                />
            </div>
        </div>
    )
}