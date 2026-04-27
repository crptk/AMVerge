// Sidebar navigation buttons. Handles switching between top-level pages like Home and Menu
import type React from "react";
import type { Page } from "./types";

type SidebarNavProps = {
  activePage: Page;
  setActivePage: React.Dispatch<React.SetStateAction<Page>>;
};

const buttons: { name: string; page: Page }[] = [
  { name: "Home", page: "home" },
  { name: "Menu", page: "menu" },
  { name: "Settings", page: "settings" },
];

export default function SidebarNav({ activePage, setActivePage }: SidebarNavProps) {
  return (
    <>
      {buttons.map((button) => (
        <div className="sidebar-button" key={button.page}>
          <button
            onClick={() => setActivePage(button.page)}
            disabled={activePage === button.page}
            aria-current={activePage === button.page ? "page" : undefined}
          >
            {button.name}
          </button>
        </div>
      ))}
    </>
  );
}