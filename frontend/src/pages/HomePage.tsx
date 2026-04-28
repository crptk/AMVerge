import ImportButtons from "../components/ImportButtons";
import MainLayout from "../MainLayout";
import { fileNameFromPath } from "../utils/episodeUtils";
import { GeneralSettings } from "../settings/generalSettings";

interface HomePageProps {
  cols: number;
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  snapGridBigger: () => void;
  snapGridSmaller: () => void;
  setGridPreview: React.Dispatch<React.SetStateAction<boolean>>;
  gridPreview: boolean;
  selectedClips: Set<string>;
  setSelectedClips: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  onImportClick: () => void;
  loading: boolean;
  mainLayoutWrapperRef: React.RefObject<HTMLDivElement | null>;
  clips: { id: string; src: string; thumbnail: string; originalName?: string }[];
  importToken: string;
  isEmpty: boolean;
  handleExport: (
    selectedClips: Set<string>,
    mergeEnabled: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  sideBarEnabled: boolean;
  videoIsHEVC: boolean | null;
  userHasHEVC: React.RefObject<boolean>;
  focusedClip: string | null;
  setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
  exportDir: string | null;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
  openedEpisodeId: string | null;
  importedVideoPath: string | null;
  generalSettings: GeneralSettings;
  setGeneralSettings: React.Dispatch<React.SetStateAction<GeneralSettings>>;
}

export default function HomePage({
  cols,
  gridSize,
  gridRef,
  snapGridBigger,
  snapGridSmaller,
  setGridPreview,
  gridPreview,
  selectedClips,
  setSelectedClips,
  onImportClick,
  loading,
  mainLayoutWrapperRef,
  clips,
  importToken,
  isEmpty,
  handleExport,
  sideBarEnabled,
  videoIsHEVC,
  userHasHEVC,
  focusedClip,
  setFocusedClip,
  exportDir,
  onPickExportDir,
  onExportDirChange,
  defaultMergedName,
  openedEpisodeId,
  importedVideoPath,
  generalSettings,
  setGeneralSettings,
}: HomePageProps) {
  return (
    <>
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

      <div className="main-layout-wrapper" ref={mainLayoutWrapperRef}>
        <MainLayout
          cols={cols}
          gridSize={gridSize}
          gridRef={gridRef}
          gridPreview={gridPreview}
          setGridPreview={setGridPreview}
          clips={clips}
          importToken={importToken}
          isEmpty={isEmpty}
          handleExport={handleExport}
          sideBarEnabled={sideBarEnabled}
          videoIsHEVC={videoIsHEVC}
          userHasHEVC={userHasHEVC}
          focusedClip={focusedClip}
          setFocusedClip={setFocusedClip}
          exportDir={exportDir}
          onPickExportDir={onPickExportDir}
          onExportDirChange={onExportDirChange}
          defaultMergedName={defaultMergedName}
          selectedClips={selectedClips}
          setSelectedClips={setSelectedClips}
          loading={loading}
          generalSettings={generalSettings}
          setGeneralSettings={setGeneralSettings}
        />

        <div className="info-bar">
          {openedEpisodeId && importedVideoPath && (
            <span className="info-bar-filename">
              {fileNameFromPath(importedVideoPath)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}