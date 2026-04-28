export default function GeneralSection() {
  return (
    <section className="settings-section">
      <h3>General</h3>
      <div className="settings-row">
        <label className="settings-label">Application Version</label>
        <div className="settings-control">
          <span className="settings-value" style={{ width: "auto" }}>
            v1.0.0
          </span>
        </div>
      </div>
    </section>
  );
}
