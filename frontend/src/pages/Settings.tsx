import { useState } from "react";
import GeneralSection from "../components/settings/GeneralSection";
import AppearanceSection from "../components/settings/AppearanceSection";

const PAGES = [
  { key: "general", label: "General" },
  { key: "appearance", label: "Appearance" },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <div className="menu-page">
      <div className="menu-header">
        <h2 className="menu-title">Settings</h2>
        <div className="menu-nav">
          {PAGES.map((page) => (
            <button
              key={page.key}
              className={`menu-nav-btn${activeTab === page.key ? " active" : ""}`}
              onClick={() => setActiveTab(page.key)}
            >
              {page.label}
            </button>
          ))}
        </div>
      </div>
      <div className="menu-content">
        <div className="menu-section">
          {activeTab === "general" && <GeneralSection />}
          {activeTab === "appearance" && <AppearanceSection />}
        </div>
      </div>
    </div>
  );
}
