import { useState } from "react";

export default function InfoBox() {
  const [platform, setPlatform] = useState<"windows" | "mac">("windows");

  return (
    <div className="info-box">
      <h3>HOW TO USE:</h3>

      {platform === "windows" ? (
        <p>
          <strong>Windows:</strong>
          <br />
          - Select multiple clips with <b>Ctrl + Click</b> or <b>Shift + Click</b>
          <br />
          - Click "Merge clips" to merge, or leave unchecked to export separately
          <br />
          - Click Export to export clips
        </p>
      ) : (
        <p>
          <strong>macOS:</strong>
          <br />
          - Select multiple clips with <b>Cmd + Click</b> or <b>Shift + Click</b>
          <br />
          - Click "Merge clips" to merge, or leave unchecked to export separately
          <br />
          - Click Export to export clips
        </p>
      )}

      {/* Dots */}
      <div className="dot-switcher">
        <span
          className={`dot ${platform === "windows" ? "active" : ""}`}
          onClick={() => setPlatform("windows")}
        />
        <span
          className={`dot ${platform === "mac" ? "active" : ""}`}
          onClick={() => setPlatform("mac")}
        />
      </div>
    </div>
  );
}
