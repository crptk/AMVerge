import { useAppStateStore } from "../../store/appStore";

interface LoadingOverlayProps {
    batchTotal: number;
    batchDone: number;
    batchCurrentFile: string;
    onAbort: () => void;
}

export default function LoadingOverlay({
  batchTotal,
  batchDone,
  batchCurrentFile,
  onAbort
}: LoadingOverlayProps) { 
  const progress = useAppStateStore(s => s.progress);
  const progressMsg = useAppStateStore(s => s.progressMsg);
  return (
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
        {batchTotal > 1 && (
          <div className="batch-progress">
            <div className="batch-counter">
              Cutting videos {batchDone + 1}/{batchTotal}...
            </div>
            <div className="batch-file-name">{batchCurrentFile}</div>
          </div>
        )}
        <button className="abort-button" onClick={onAbort}>
          Abort
        </button>
      </div>
    </div>
  );
}