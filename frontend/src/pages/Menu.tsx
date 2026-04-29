import { useState } from "react";
import About from "../components/menu/About";
import Console from "../components/menu/Console";
import PatchNotes from "../components/menu/PatchNotes";
import Credits from "../components/menu/Credits";

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
          {activePage === "about" && <About />}
          {activePage === "console" && <Console />}
          {activePage === "logs" && <PatchNotes />}
          {activePage === "credits" && <Credits />}
        </div>
      </div>
    </div>
  );
}