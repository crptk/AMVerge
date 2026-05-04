// Root sidebar container. Composes SidebarNav and EpisodePanel, then passes sidebar-related props down
import SidebarNav from "./SidebarNav";
import EpisodePanel from "./episodePanel/EpisodePanel";
import ClipsContainer from "../clipsGrid/ClipsContainer";
import { useUIStateStore } from "../../stores/UIStore";

export default function Sidebar() {
  const activeMode = useUIStateStore((state) => state.activeMode);

  return (
    <div className="sidebar-container">
      <SidebarNav />
      
      {activeMode === "selector" ? (
        <EpisodePanel />
      ) : (
        <div className="sidebar-library">
          <div className="episode-panel-header">
            <div className="episode-panel-title">Clip Assets</div>
          </div>
          <ClipsContainer cols={2} />
        </div>
      )}
    </div>
  );
}