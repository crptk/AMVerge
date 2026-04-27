import { useState } from "react";
import AboutSection from "../components/menu/AboutSection";
import ConsoleSection from "../components/menu/ConsoleSection";
import LogsSection from "../components/menu/LogsSection";
import CreditSection from "../components/menu/CreditSection";

const PAGES = [
  { key: "about", label: "About" },
  { key: "console", label: "Console" },
  { key: "logs", label: "Update logs" },
  { key: "credits", label: "Credits" },
];

export default function Menu() {
  const [activePage, setActivePage] = useState("about");

  return (
    <div className="menu-page">
      <div className="menu-header">
        <h2 className="menu-title">Menu</h2>
        <div className="menu-nav">
          {PAGES.map((page) => (
            <button
              key={page.key}
              className={`menu-nav-btn${activePage === page.key ? " active" : ""}`}
              onClick={() => setActivePage(page.key)}
            >
              {page.label}
            </button>
          ))}
        </div>
      </div>
      <div className="menu-content">
        <div className="menu-section">
          {activePage === "about" && <AboutSection />}
          {activePage === "console" && <ConsoleSection />}
          {activePage === "logs" && <LogsSection />}
          {activePage === "credits" && <CreditSection />}
        </div>
      </div>
    </div>
  );
}