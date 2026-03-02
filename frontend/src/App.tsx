import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import Navbar from "./components/Navbar";
import ImportButtons from "./components/ImportButtons";
import "./App.css";
import MainLayout from "./MainLayout";

function App() {
  /*
  Create setSelectedClip function, whatever gets passed into it
  becomes selectedClip
  */
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [importToken, setImportToken] = useState(() => Date.now().toString());
  const [clips, setClips] = useState<{ id: string; src: string; thumbnail: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [gridPreview, setGridPreview] = useState<true | false>(false);
  const [cols, setCols] = useState(6);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Starting..."); 
  const [isEmpty, setIsEmpty] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);

  const snapGridBigger = () => {
    setCols(c => Math.max(1, c - 1));
  };

  const detectScenes = async (videoPath: string) => {
    // calls backend passing in video file and threshold
    const result = await invoke<string>("detect_scenes", {
      videoPath: videoPath,
    });

    // contains path to all clips along w other metadata
    console.log("Raw result:", result);
    const scenes = JSON.parse(result);
    console.log("Parsed scenes:", scenes); 

    // turns to an array of objects
    return scenes.map((s: any) => ({
      id: crypto.randomUUID(),
      src: s.path,
      thumbnail: s.thumbnail
    }));
  };

  const handleImport = async () => {
    // This opens the file dialog to select a video file
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mkv", "mov"]
        }
      ]
    });

    if (!file) return;

    try {
      setIsEmpty(false);
      setProgress(0);
      setProgressMsg("Starting...");
      setLoading(true);

      setImportToken(Date.now().toString());
      const formatted = await detectScenes(file);

      setClips(formatted); // sets all the clips which gets passed to MainLayout
    } catch (err) {
      console.error("Detection failed:", err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleExport = async(selectedClips: Set<string>, mergeEnabled: boolean) => {
    if (selectedClips.size === 0) return;

    const savePath = await save({
      filters: [
        {
          name: "Video",
          extensions: ["mp4"]
        }
      ]
    });

    if (!savePath) return;

    try {
      setLoading(true);

      const clipArray = clips
        .filter(c => selectedClips.has(c.id))
        .map(c => c.src);
      
      await invoke("export_clips", {
        clips: clipArray,
        savePath: savePath,
        mergeEnabled: mergeEnabled
      });
      
      console.log("Export complete");
    } catch (err) {
      console.log("Export failed:", err)
    } finally {
      setLoading(false);
    }
  };

  const snapGridSmaller = () => {
    setCols(c => Math.min(12, c + 1));
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      const stop = await listen<{ percent: number; message: string }>(
        "scene_progress",
        (event) => {
          setProgress(event.payload.percent);
          setProgressMsg(event.payload.message);
        }
      );
      unlisten = stop;
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <main>
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="loading-text">

            <div>{progressMsg}</div>
            <div>{progress}%</div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}
      <Navbar />
      <ImportButtons 
        cols={cols}
        gridSize={gridSize}
        onBigger={snapGridBigger}
        onSmaller={snapGridSmaller}
        setGridPreview={setGridPreview}
        gridPreview={gridPreview}
        selectedClips={selectedClips}
        setSelectedClips={setSelectedClips}
        onImport={handleImport}
        loading={loading}
      />
      <div className="main" >
        <MainLayout 
         cols={cols}
         gridSize={gridSize}
         gridRef={gridRef}
         gridPreview={gridPreview}
         selectedClips={selectedClips}
         setSelectedClips={setSelectedClips}
         clips={clips}
         importToken={importToken}
         loading={loading}
         isEmpty={isEmpty}
         handleExport={handleExport}/>
      </div>
    </main>
  );
}

export default App;
