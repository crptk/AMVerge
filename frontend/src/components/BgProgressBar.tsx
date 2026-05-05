type BgProgress = { done: number; total: number };

export default function BgProgressBar({ done, total }: BgProgress) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="bg-progress-bar">
      <span className="bg-progress-label">Processing clips {done}/{total}</span>
      <div className="progress-bar" style={{ width: "100%", marginTop: 4, marginLeft: 0, marginRight: 0 }}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
