import ImportButtons from "../components/ImportButtons";
import MainLayout from "../MainLayout";
import { fileNameFromPath } from "../utils/episodeUtils";
import { ClipItem } from "../types/domain";
import { useEpisodePanelRuntimeStore} from "../store/episodeStore"

interface HomePageProps {
  gridSize: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  snapGridBigger: () => void;
  snapGridSmaller: () => void;
  onImportClick: () => void;
  mainLayoutWrapperRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  handleExport: (
    selectedClips: Set<string>,
    mergeEnabled: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  userHasHEVC: React.RefObject<boolean>;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  defaultMergedName: string;
  onDownloadClip: (clip: ClipItem) => void;
}

export default function HomePage({
  gridSize,
  gridRef,
  isEmpty,
  snapGridBigger,
  snapGridSmaller,
  onImportClick,
  mainLayoutWrapperRef,
  handleExport,
  userHasHEVC,
  onPickExportDir,
  onExportDirChange,
  defaultMergedName,
  onDownloadClip,
}: HomePageProps) {
  const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  const importedVideoPath = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  return (
    <>
      <ImportButtons
        gridSize={gridSize}
        onBigger={snapGridBigger}
        onSmaller={snapGridSmaller}
        onImport={onImportClick}
      />

      <div className="main-layout-wrapper" ref={mainLayoutWrapperRef}>
        <MainLayout
          gridSize={gridSize}
          gridRef={gridRef}
          isEmpty={isEmpty}
          handleExport={handleExport}
          userHasHEVC={userHasHEVC}
          onPickExportDir={onPickExportDir}
          onExportDirChange={onExportDirChange}
          defaultMergedName={defaultMergedName}
          onDownloadClip={onDownloadClip}
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