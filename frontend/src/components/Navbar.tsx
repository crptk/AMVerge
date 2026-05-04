

type NavbarProps = {
    setSidebarEnabled: (val: boolean | ((prev: boolean) => boolean)) => void
    sidebarEnabled: boolean
    userHasHEVC: boolean
    videoIsHEVC: boolean | null
}
export default function Navbar({ setSidebarEnabled, sidebarEnabled, userHasHEVC, videoIsHEVC }: NavbarProps ) {
    return (
        <div className="navbar">
            <div className="left-nav">
                <svg
                    onClick={() => setSidebarEnabled(prev => !prev)}
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