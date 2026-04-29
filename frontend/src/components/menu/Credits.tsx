import { open } from '@tauri-apps/plugin-shell';

export default function Credits() {
    return (
        <div className="panel menu-panel">
            <div className="patchnotes-header">
                <h3>Contributors</h3>
                <p>Learn about the people who made AMVerge come to life!</p>
            </div>
            <div className="credits-content">
                <div className="credits-row">
                    <h4>Creator/Maintainer</h4>
                    <div className="credits-row-inner">
                        <p>Crptk</p>
                    </div>
                </div>
                <div className="credits-row">
                    <h4>Main Developers</h4>
                    <div className="credits-row-inner">
                        <p>Netsuma</p>
                        <p>Moongetsu</p>
                    </div>
                </div>
                <div className="credits-row">
                    <h4>Contributors</h4>
                    <div className="credits-row-inner">
                        <p>Looking to contribute? Feel free to do so 
                            {" "}
                            <a
                            href="#"
                            onClick={e => {
                                e.preventDefault();
                                open("https://github.com/crptk/AMVerge");
                            }}
                            > here</a>
                            .
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}