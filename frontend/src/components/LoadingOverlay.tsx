interface LoadingOverlayProps {
    progress: number;
    progressMsg: string;
    batchTotal: number;
    batchDone: number;
    batchCurrentFile: string;
    onAbort: () => void;
    showCancel?: boolean;
    cancelLabel?: string;
    onCancel?: () => void;
}

export default function LoadingOverlay({
  progress,
  progressMsg,
  batchTotal,
  batchDone,
  batchCurrentFile,
  onAbort,
  showCancel = false,
  cancelLabel = "Cancel",
  onCancel
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
        {batchTotal > 1 && (
          <div className="batch-progress">
            <div className="batch-counter">
              Cutting videos {batchDone + 1}/{batchTotal}...
            </div>
            <div className="batch-file-name">{batchCurrentFile}</div>
            <button className="loader-action-button" onClick={onAbort}>
              Cancel
            </button>
          </div>
        )}
        {showCancel && (
          <div className="loader-cancel-row">
            <button className="loader-action-button" onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
