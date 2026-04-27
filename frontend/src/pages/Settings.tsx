import { useState } from "react";
import GeneralSection from "../components/settings/GeneralSection";
import AppearanceSection from "../components/settings/AppearanceSection";
import { type ThemeSettings } from "../theme";

const PAGES = [
  { key: "general", label: "General" },
  { key: "appearance", label: "Appearance" },
];

type SettingsProps = {
  settings: ThemeSettings;
  setSettings: React.Dispatch<React.SetStateAction<ThemeSettings>>;
  onReset: () => void;
  onEpisodesPathChanged: (oldPath: string, newPath: string) => void;
};

export default function Settings({
  settings,
  setSettings,
  onReset,
  onEpisodesPathChanged,
}: SettingsProps) {
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
              <GeneralSection
                settings={settings}
                setSettings={setSettings}
                onReset={onReset}
                onEpisodesPathChanged={onEpisodesPathChanged}
              />
            )}

            {activeTab === "appearance" && (
              <AppearanceSection
                settings={settings}
                setSettings={setSettings}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}