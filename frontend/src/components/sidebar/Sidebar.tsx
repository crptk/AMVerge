// Root sidebar container. Composes SidebarNav and EpisodePanel, then passes sidebar-related props down
import SidebarNav from "./SidebarNav";
import EpisodePanel from "./episodePanel/EpisodePanel";
import ClipsContainer from "../clipsGrid/ClipsContainer";
import type { SidebarProps } from "./types";

export default function Sidebar({
  activePage,
  setActivePage,
  ...episodePanelProps
}: SidebarProps) {
  return (
    <div className="sidebar-container">
      <SidebarNav activePage={activePage} setActivePage={setActivePage} />
      <EpisodePanel {...episodePanelProps} />
    </div>
  );
}