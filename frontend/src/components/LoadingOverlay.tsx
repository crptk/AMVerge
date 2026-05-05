interface LoadingOverlayProps {
    progress: number;
    progressMsg: string;
    batchTotal: number;
    batchDone: number;
    batchCurrentFile: string;
    onAbort: () => void;
}

export default function LoadingOverlay({
  progress,
  progressMsg,
  batchTotal,
  batchDone,
  batchCurrentFile,
  onAbort
}: LoadingOverlayProps) {
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
        <button className="abort-button" onClick={onAbort}>
          Abort
        </button>
        {batchTotal > 1 && (
          <div className="batch-progress">
            <div className="batch-counter">
              Cutting videos {batchDone + 1}/{batchTotal}...
            </div>
            <div className="batch-file-name">{batchCurrentFile}</div>
          </div>
        )}
      </div>
    </div>
  );
}
