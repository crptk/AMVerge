import { useState } from "react"
import ClipsContainer from "./components/ClipsContainer";
import PreviewContainer from "./components/PreviewContainer";

type LayoutProps = {
    cols: number;
    gridSize: number;
    gridRef: React.RefObject<HTMLDivElement | null>;
    gridPreview: boolean;
    selectedClips: Set<string>;
    setSelectedClips: React.Dispatch<
        React.SetStateAction<Set<string>>
    >;

};
export default function MainLayout(props: LayoutProps) {
    const [leftWidth, setLeftWidth] = useState(65);
    const [selectedClip, setSelectedClip] = useState<string | null>(null);
    /*
    startResize is the function used to resize the PreviewContainer and ClipsContainer
    Notes:
    - e: The MouseEvent() object, it's passed in on declaration of the object
         and is used to track all mouse interactions with the window
    */
    const startResize = (e: React.MouseEvent<HTMLDivElement>) => {
        const startX = e.clientX;

        /*
        The container is located below in the HTML portion of this file
        container (.split-layout)
        ├─ leftPane
        ├─ divider
        └─ rightPane
        */
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
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        console.log("Mouse clicked!", e.clientX)
    }
    return (
        <div className="split-layout">
            <div className="left-pane" style={{ width: `${leftWidth}%`}}>
                <ClipsContainer 
                 onSelectClip={setSelectedClip} 
                 gridSize={props.gridSize}
                 gridRef={props.gridRef}
                 cols={props.cols}
                 gridPreview={props.gridPreview}
                 selectedClips={props.selectedClips}
                 setSelectedClips={props.setSelectedClips}/>
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
                selectedClip={selectedClip} />
            </div>
        </div>
    )
}