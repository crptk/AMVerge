// Root sidebar container. Composes SidebarNav and EpisodePanel, then passes sidebar-related props down
import SidebarNav from "./SidebarNav";
import EpisodePanel from "./episodePanel/EpisodePanel";
import ClipsContainer from "../clipsGrid/ClipsContainer";
import type { SidebarProps } from "./types";
import { FaVideo } from "react-icons/fa";

export default function Sidebar({
  activePage,
  setActivePage,
  ...props
}: SidebarProps) {
  return (
    <div className="sidebar-container">
      <SidebarNav activePage={activePage} setActivePage={setActivePage} />
      
      {props.activeMode === "selector" ? (
        <EpisodePanel {...props} />
      ) : (
        <div className="sidebar-library">
          <div className="episode-panel-header">
            <div className="episode-panel-title">Clip Assets</div>
          </div>
          <ClipsContainer {...props} cols={2} />
        </div>
      )}
    </div>
  );
}