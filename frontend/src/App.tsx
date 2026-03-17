import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import Navbar from "./components/Navbar.tsx";
import ImportButtons from "./components/ImportButtons.tsx";
import MainLayout from "./MainLayout";
// import Sidebar from "./components/Sidebar.tsx"
import "./App.css";

function App() {
  /*
  Create setSelectedClip function, whatever gets passed into it
  becomes selectedClip
  */
  const [focusedClip, setFocusedClip] = useState<string | null>(null);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [importToken, setImportToken] = useState(() => Date.now().toString());
  const [clips, setClips] = useState<{ id: string; src: string; thumbnail: string; originalName?: string }[]>([]);
  const [importedVideoPath, setImportedVideoPath] = useState<string | null>(null)
  const [videoIsHEVC, setVideoIsHEVC] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [gridPreview, setGridPreview] = useState<true | false>(false);
  const [cols, setCols] = useState(6);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("Starting..."); 
  const [isEmpty, setIsEmpty] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [sideBarEnabled, setSideBarEnabled] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const userHasHEVC = useRef<boolean>(false)
  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);

  // Detect whether the current WebView can decode HEVC (e.g., HEVC Video Extensions on Windows).
  // This is used as a capability gate: if HEVC is supported, we skip proxy logic and prefer originals.
  useEffect(() => {
    try {
      const candidates = [
        'video/mp4; codecs="hvc1"',
        'video/mp4; codecs="hev1"',
        'video/mp4; codecs="hvc1.1.6.L93.B0"',
        'video/mp4; codecs="hev1.1.6.L93.B0"',
      ];

      const mediaSourceSupported = typeof (window as any).MediaSource !== "undefined";
      const isTypeSupported = mediaSourceSupported
        ? (mime: string) => (window as any).MediaSource.isTypeSupported(mime)
        : (_mime: string) => false;

      const videoEl = document.createElement("video");
      const canPlay = (mime: string) => {
        const result = videoEl.canPlayType(mime);
        return result === "probably" || result === "maybe";
      };

      userHasHEVC.current = candidates.some((c) => isTypeSupported(c) || canPlay(c));

      if (import.meta.env.DEV) {
        console.log("[amverge] userHasHEVC:", userHasHEVC.current);
      }
    } catch {
      userHasHEVC.current = false;
    }
  }, []);

  const snapGridBigger = () => {
    setCols(c => Math.max(1, c - 1));
  };

  const detectScenes = async (videoPath: string) => {
    // calls backend passing in video file and threshold
    const result = await invoke<string>("detect_scenes", {
      videoPath: videoPath,
    });

    // contains path to all clips along w other metadata
    const scenes = JSON.parse(result);

    // turns to an array of objects
    return scenes.map((s: any) => ({
      id: crypto.randomUUID(),
      src: s.path,
      thumbnail: s.thumbnail,
      originalName: s.original_file
    }));
  };

  const onImportClick = async () => {
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mkv", "mov"]
        }
      ]
    });

    handleImport(file)
  }

  const handleImport = async (file: string | null) => {
    // This opens the file dialog to select a video file
    if (!file) return;

    try {
      setIsEmpty(false);
      setProgress(0);
      setProgressMsg("Starting...");
      setLoading(true);
      setImportedVideoPath(file)
      setVideoIsHEVC(null);
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

    const selected = clips.filter(c => selectedClips.has(c.id));
    if (selected.length === 0) return;

    try {
      setLoading(true);

      const clipArray = selected.map(c => c.src);

      if (mergeEnabled) {
        const episodeName = selected[0]?.originalName || "episode";
        const suffix = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");
        const defaultName = `${episodeName}_merged_${suffix}.mp4`;

        const savePath = await save({
          filters: [
            {
              name: "Video",
              extensions: ["mp4"],
            },
          ],
          defaultPath: defaultName,
        });

        if (!savePath) return;

        await invoke("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: mergeEnabled,
        });
      } else {
        const firstClipPath = selected[0]?.src || "";
        const firstFile = firstClipPath.split(/[/\\]/).pop() || "episode_0000.mp4";
        const firstStem = firstFile.replace(/\.[^/.]+$/, "");
        const defaultBase = firstStem.replace(/_\d{4}$/, "");

        const savePath = await save({
          title: "Choose base name for exported clips",
          filters: [
            {
              name: "Video",
              extensions: ["mp4"],
            },
          ],
          defaultPath: `${defaultBase}_####.mp4`,
        });

        if (!savePath) return;

        await invoke("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: false,
        });
      }
      
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

  // loading effect
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


  // drag & drop files effect
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const init = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const type = event.payload.type;

        if (type === "over") {
          // Only show the overlay for true external file drags.
          const paths = (event.payload as { paths?: string[] }).paths;
          const hasPaths = Array.isArray(paths) && paths.length > 0;
          setIsDragging(hasPaths);
          return;
        }

        if (type === "drop") {
          setIsDragging(false);

          const file = event.payload.paths?.[0];
          if (!file) return;

          handleImport(file);
          return;
        }

        setIsDragging(false);
      });
    }

    init();
    
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // checking if video is hevc useEffect
  useEffect(() => {
    if (!importedVideoPath) {
      setVideoIsHEVC(null);
      return;
    }

    let cancelled = false;

    // Mark as "checking" for this import so hover previews can avoid black-screen attempts.
    setVideoIsHEVC(null);

    (async () => {
      try {
        const hevc = await invoke<boolean>("check_hevc", {
          videoPath: importedVideoPath
        });

        if (!cancelled) setVideoIsHEVC(hevc)
      } catch (err) {
        console.error("check_hevc failed:", err)
        if (!cancelled) setVideoIsHEVC(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importedVideoPath, importToken])

  return (
    <main className="app-root">
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

      {isDragging && (
        <div className="dragging-overlay">
          <h1>Drag file(s) here.</h1>
        </div>

      )}
      <div className="window-wrapper">
        {/* {sideBarEnabled && <Sidebar/>} */}
        <div className="content-wrapper">
          <Navbar 
           setSideBarEnabled={setSideBarEnabled}
           userHasHEVC={userHasHEVC}
           videoIsHEVC={videoIsHEVC}/>
          <div className="main-content">
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
            />
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
            handleExport={handleExport}
            sideBarEnabled={sideBarEnabled}
            videoIsHEVC={videoIsHEVC}
            userHasHEVC={userHasHEVC}
            focusedClip={focusedClip}
            setFocusedClip={setFocusedClip}
          />
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
