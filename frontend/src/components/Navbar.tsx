import { useAppStateStore } from "../store/appStore";
import { useUIStateStore } from "../store/UIStore";

type NavbarProps = {
  userHasHEVC: boolean;
};

export default function Navbar(userHasHEVC: NavbarProps) {
    // setSideBarEnabled(true) // just putting this here to remove error

    const videoIsHEVC = useAppStateStore(s => s.videoIsHEVC);
    const sidebarEnabled = useUIStateStore(s => s.sidebarEnabled);
    const setSideBarEnabled = useUIStateStore(s => s.setSidebarEnabled);
    return (
        <div className="navbar">
            <div className="left-nav">
                <svg
                    onClick={() => setSideBarEnabled(prev => !prev)}
                    width="24" height="24" viewBox="0 0 24 24"
                    fill="none" xmlns="http://www.w3.org/2000/svg"
                    style={{ transform: sidebarEnabled ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                >
                    <path d="M9 6l6 6-6 6" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <h1><span>AMV</span>erge</h1>
            </div>

            <div className="hevc-check">
            <div className="hevc-row">
                <span>user has hevc?</span>
                <span className={`status-dot ${userHasHEVC ? "ok" : "bad"}`} />
            </div>

            {!userHasHEVC && (
                <div className="hevc-row">
                <span>video is HEVC encoded?</span>
                <span
                    className={`status-dot ${
                    videoIsHEVC === true ? "ok" : videoIsHEVC === false ? "bad" : "unknown"
                    }`}
                />
                </div>
            )}
            </div>
        </div>
    )
}