import { useState } from "react";
import { FaChevronDown, FaChevronUp, FaQuestionCircle, FaWindows, FaApple, FaLinux } from "react-icons/fa";

export default function InfoBox() {
  const [platform, setPlatform] = useState<"windows" | "mac" | "linux">("windows");
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`info-panel ${isExpanded ? "expanded" : "collapsed"}`}>
      <div className="info-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="info-header-left">
          <FaQuestionCircle className="info-icon" />
          <span className="info-title">HOW TO USE</span>
        </div>
        <button className="info-toggle">
          {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
        </button>
      </div>

      {isExpanded && (
        <div className="info-content">
          <div className="platform-switcher">
            <button 
              className={`platform-btn ${platform === "windows" ? "active" : ""}`}
              onClick={() => setPlatform("windows")}
            >
              <FaWindows /> Windows
            </button>
            <button 
              className={`platform-btn ${platform === "mac" ? "active" : ""}`}
              onClick={() => setPlatform("mac")}
            >
              <FaApple /> macOS
            </button>
            <button 
              className={`platform-btn ${platform === "linux" ? "active" : ""}`}
              onClick={() => setPlatform("linux")}
            >
              <FaLinux /> Linux
            </button>
          </div>

          <div className="info-steps">
            {platform === "windows" ? (
              <ul className="steps-list">
                <li>Select clips with <b>Ctrl + Click</b> or <b>Shift + Click</b></li>
                <li>Double click to <b>Focus</b> a clip</li>
                <li>Toggle <b>Merge clips</b> to export as one file</li>
                <li>Click <b>Export Now</b> to start the process</li>
              </ul>
            ) : platform === "mac" ? (
              <ul className="steps-list">
                <li>Select clips with <b>Cmd + Click</b> or <b>Shift + Click</b></li>
                <li>Double click to <b>Focus</b> a clip</li>
                <li>Toggle <b>Merge clips</b> to export as one file</li>
                <li>Click <b>Export Now</b> to start the process</li>
              </ul>
            ) : (
              <ul className="steps-list">
                <li>Select clips with <b>Ctrl + Click</b> or <b>Shift + Click</b></li>
                <li>Double click to <b>Focus</b> a clip</li>
                <li>Toggle <b>Merge clips</b> to export as one file</li>
                <li>Click <b>Export Now</b> to start the process</li>
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
