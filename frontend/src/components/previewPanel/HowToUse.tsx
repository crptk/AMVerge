import { useState } from "react";
import { FaChevronDown, FaChevronUp, FaQuestionCircle, FaWindows, FaApple, FaLinux } from "react-icons/fa";

type Platform = "windows" | "mac" | "linux";

const STEPS: Record<Platform, React.ReactNode[]> = {
  windows: [
    <>Select clips with <b>Ctrl + Click</b> or <b>Shift + Click</b></>,
    <>Double click to <b>Focus</b> a clip</>,
    <>Toggle <b>Merge clips</b> to export as one file</>,
    <>Click <b>Export Now</b> to start the process</>,
  ],
  mac: [
    <>Select clips with <b>Cmd + Click</b> or <b>Shift + Click</b></>,
    <>Double click to <b>Focus</b> a clip</>,
    <>Toggle <b>Merge clips</b> to export as one file</>,
    <>Click <b>Export Now</b> to start the process</>,
  ],
  linux: [
    <>Select clips with <b>Ctrl + Click</b> or <b>Shift + Click</b></>,
    <>Double click to <b>Focus</b> a clip</>,
    <>Toggle <b>Merge clips</b> to export as one file</>,
    <>Click <b>Export Now</b> to start the process</>,
  ],
};

export default function HowToUse() {
  const [platform, setPlatform] = useState<Platform>("windows");
  const [isExpanded, setIsExpanded] = useState(true);

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
              onClick={(e) => { e.stopPropagation(); setPlatform("windows"); }}
            >
              <FaWindows /> Windows
            </button>
            <button 
              className={`platform-btn ${platform === "mac" ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setPlatform("mac"); }}
            >
              <FaApple /> macOS
            </button>
            <button 
              className={`platform-btn ${platform === "linux" ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setPlatform("linux"); }}
            >
              <FaLinux /> Linux
            </button>
          </div>

          <div className="info-steps">
            <ul className="steps-list">
              {STEPS[platform].map((step, index) => (
                <li key={index}>
                  <span className="step-text">{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
