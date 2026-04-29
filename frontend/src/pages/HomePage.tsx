import ImportButtons from "../components/ImportButtons";
import MainLayout from "../MainLayout";
import { fileNameFromPath } from "../utils/episodeUtils";
import { ThemeSettings } from "../settings/themeSettings";
import { ClipItem } from "../types/domain";
import { useAppStateStore } from "../store/appStore"

interface HomePageProps {
  cols: number;
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  snapGridBigger: () => void;
  snapGridSmaller: () => void;
  setGridPreview: React.Dispatch<React.SetStateAction<boolean>>;
  gridPreview: boolean;
  onImportClick: () => void;
  loading: boolean;
  mainLayoutWrapperRef: React.RefObject<HTMLDivElement | null>;
  importToken: string;
  isEmpty: boolean;
  handleExport: (
    selectedClips: Set<string>,
    mergeEnabled: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  sideBarEnabled: boolean;
  userHasHEVC: React.RefObject<boolean>;
  exportDir: string | null;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
  onDownloadClip: (clip: ClipItem) => void;
  themeSettings: ThemeSettings;
}

export default function HomePage({
  cols,
  gridSize,
  gridRef,
  snapGridBigger,
  snapGridSmaller,
  setGridPreview,
  gridPreview,
  onImportClick,
  loading,
  mainLayoutWrapperRef,
  importToken,
  isEmpty,
  handleExport,
  sideBarEnabled,
  userHasHEVC,
  exportDir,
  onPickExportDir,
  onExportDirChange,
  defaultMergedName,
  onDownloadClip,
  themeSettings,
}: HomePageProps) {
  const openedEpisodeId = useAppStateStore(s => s.openedEpisodeId);
  const importedVideoPath = useAppStateStore(s => s.openedEpisodeId);

  return (
    <>
      <ImportButtons
        cols={cols}
        gridSize={gridSize}
        onBigger={snapGridBigger}
        onSmaller={snapGridSmaller}
        setGridPreview={setGridPreview}
        gridPreview={gridPreview}
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
          importToken={importToken}
          isEmpty={isEmpty}
          handleExport={handleExport}
          sideBarEnabled={sideBarEnabled}
          userHasHEVC={userHasHEVC}
          exportDir={exportDir}
          onPickExportDir={onPickExportDir}
          onExportDirChange={onExportDirChange}
          defaultMergedName={defaultMergedName}
          loading={loading}
          onDownloadClip={onDownloadClip}
          themeSettings={themeSettings}
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