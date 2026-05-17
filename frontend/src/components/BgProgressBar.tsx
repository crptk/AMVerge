type BgProgress = {
  done: number;
  total: number;
  onClose: () => void;
};

export default function BgProgressBar({ done, total, onClose }: BgProgress) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="bg-progress-bar">
      <div className="bg-progress-head">
        <span className="bg-progress-label">Processing clips {done}/{total}</span>
        <button
          type="button"
          className="bg-progress-close"
          onClick={onClose}
          aria-label="Close processing indicator"
          title="Close"
        >
          x
        </button>
      </div>
      <div className="progress-bar" style={{ width: "100%", marginTop: 4, marginLeft: 0, marginRight: 0 }}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
