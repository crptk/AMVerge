// Sidebar navigation buttons. Handles switching between top-level pages like Home and Menu
import type React from "react";
import type { IconType } from "react-icons";
import { FaBars, FaCog, FaHome } from "react-icons/fa";
import type { Page } from "./types";

type SidebarNavProps = {
  activePage: Page;
  setActivePage: React.Dispatch<React.SetStateAction<Page>>;
};

const buttons: { name: string; page: Page; icon: IconType }[] = [
  { name: "Home", page: "home", icon: FaHome },
  { name: "Menu", page: "menu", icon: FaBars },
  { name: "Settings", page: "settings", icon: FaCog },
];

export default function SidebarNav({ activePage, setActivePage }: SidebarNavProps) {
  return (
    <div className="menu-buttons">
      {buttons.map((button) => {
        const Icon = button.icon;
        const isActive = activePage === button.page;

        return (
          <div className="sidebar-button" key={button.page}>
            <button
              type="button"
              className={`sidebar-nav-button${isActive ? " is-active" : ""}`}
              onClick={() => setActivePage(button.page)}
              disabled={isActive}
              aria-current={isActive ? "page" : undefined}
              aria-label={button.name}
              title={button.name}
            >
              <Icon aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
