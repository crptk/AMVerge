import ImportButtons from "../components/ImportButtons";
import MainLayout from "../components/MainLayout";
import { fileNameFromPath } from "../utils/episodeUtils";
import { ClipItem } from "../types/domain";
import { useEpisodePanelRuntimeStore } from "../store/episodeStore"
import { useAppStateStore } from "../store/appStore"

interface HomePageProps {
  gridRef: React.RefObject<HTMLDivElement | null>;
  onImportClick: () => void;
  mainLayoutWrapperRef: React.RefObject<HTMLDivElement | null>;
  handleExport: (
    selectedClips: Set<string>,
    mergeEnabled: boolean,
    mergeFileName?: string
  ) => Promise<void>;
  userHasHEVC: React.RefObject<boolean>;
  onPickExportDir: () => void;
  onExportDirChange: (dir: string) => void;
  onDownloadClip: (clip: ClipItem) => void;
}

export default function HomePage({
  gridRef,
  onImportClick,
  mainLayoutWrapperRef,
  handleExport,
  userHasHEVC,
  onPickExportDir,
  onExportDirChange,
  onDownloadClip,
}: HomePageProps) {
  const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
  const importedVideoPath = useAppStateStore(s => s.importedVideoPath);
  const clips = useAppStateStore(s => s.clips);
  const isEmpty = clips.length === 0;
  const defaultMergedName = (clips[0]?.originalName || "episode") + "_merged";

  return (
    <>
      <ImportButtons
        gridRef={gridRef}
        onImport={onImportClick}
      />

      <div className="main-layout-wrapper" ref={mainLayoutWrapperRef}>
        <MainLayout
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