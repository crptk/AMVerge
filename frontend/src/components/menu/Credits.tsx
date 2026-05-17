import { open } from '@tauri-apps/plugin-shell';

export default function Credits() {
    const team = [
        { name: 'Crptk', role: 'App Owner, Developer' },
        { name: 'Netsuma', role: 'Export settings, UI Upgrades' },
        { name: 'Moongetsu', role: 'Tons of new settings, Discord RPC, Menu revamp'},
        { name: 'Lewis', role: 'Background processes, Heavy optimizations' },
        { name: '0xkhaosoccured', role: 'Grid UI Fixes' },
    ];

    return (
        <div className="panel menu-panel">
            <div className="patchnotes-header">
                <h3>Contributors</h3>
                <p>Learn about the people who made AMVerge come to life!</p>
            </div>
            <div className="credits-content">
                <div className="credits-row credits-team-list">
                    {team.map((member) => (
                        <p key={member.name} className="credits-team-member">
                            <span className="credits-team-name">{member.name}</span>
                            <span className="credits-team-role">{member.role}</span>
                        </p>
                    ))}
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