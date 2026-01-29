import { useState, useRef } from "react";
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
  const [gridPreview, setGridPreview] = useState<true | false>(false);
  const [cols, setCols] = useState(6);
  const gridRef = useRef<HTMLDivElement>(null);
  const width = gridRef.current?.offsetWidth || 0;
  const gridSize = Math.floor(width / cols);

  console.log("Grid width:", width);
  // divides width of grid by input grid size
  const currentCols = Math.max(
    1, // has to be minimum 1 column so we max it with 1 here
    Math.floor(width / (gridSize))
  );

  console.log("Current columns:", currentCols);
  const snapGridBigger = () => {
    setCols(c => Math.max(1, c - 1));
  };


  const snapGridSmaller = () => {
    setCols(c => Math.min(12, c + 1));
  };

  return (
    <main>
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
      />
      <div className="main" >
        <MainLayout 
         cols={cols}
         gridSize={gridSize}
         gridRef={gridRef}
         gridPreview={gridPreview}
         selectedClips={selectedClips}
         setSelectedClips={setSelectedClips}/>
      </div>
    </main>
  );
}

export default App;
