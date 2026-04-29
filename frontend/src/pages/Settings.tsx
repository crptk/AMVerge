import { useState } from "react";
import GeneralSection from "../components/settings/GeneralSection";
import AppearanceSection from "../components/settings/AppearanceSection";
import DiscordRPCSection from "../components/settings/DiscordRPCSection";
import { useAppStateStore } from "../store/appStore";
import { remapPathRoot } from "../utils/episodeUtils";
const PAGES = [
  { key: "general", label: "General" },
  { key: "appearance", label: "Appearance" },
  { key: "discord", label: "Discord RPC" },
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
          <div className="tab-content" style={{ flex: 1 }}>
            {activeTab === "general" && (
              <GeneralSection/>
            )}

            {activeTab === "appearance" && (
              <AppearanceSection/>
            )}

            {activeTab === "discord" && (
              <DiscordRPCSection
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}