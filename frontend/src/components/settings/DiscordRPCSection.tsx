import { useGeneralSettingsStore } from "../../stores/settingsStore";

export default function DiscordRPCSection() {
  const generalSettings = useGeneralSettingsStore();
  const setGeneralSettings = useGeneralSettingsStore.setState;
  return (
    <section className="panel">
      <h3>Discord Rich Presence</h3>

      <div className="settings-row">
        <label className="settings-label">Enable Rich Presence</label>
        <div className="settings-control">
          <label className="custom-checkbox">
            <input
              type="checkbox"
              className="checkbox"
              checked={generalSettings.discordRPCEnabled}
              onChange={(e) =>
                setGeneralSettings((prev) => ({
                  ...prev,
                  discordRPCEnabled: e.target.checked,
                }))
              }
            />
            <span className="checkmark"></span>
          </label>
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
        Display your current AMVerge activity on your Discord profile.
      </p>

      {generalSettings.discordRPCEnabled && (
        <>
          <div className="settings-row">
            <label className="settings-label">Show filename</label>
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={generalSettings.rpcShowFilename}
                  onChange={(e) =>
                    setGeneralSettings((prev) => ({
                      ...prev,
                      rpcShowFilename: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          </div>
          <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
            Shows the name of the video you are currently editing.
          </p>

          <div className="settings-row">
            <label className="settings-label">Show status icons</label>
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={generalSettings.rpcShowMiniIcons}
                  onChange={(e) =>
                    setGeneralSettings((prev) => ({
                      ...prev,
                      rpcShowMiniIcons: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          </div>
          <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
            Displays mini icons for editing, loading, and saving status.
          </p>

          <div className="settings-row">
            <label className="settings-label">Show profile buttons</label>
            <div className="settings-control">
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={generalSettings.rpcShowButtons}
                  onChange={(e) =>
                    setGeneralSettings((prev) => ({
                      ...prev,
                      rpcShowButtons: e.target.checked,
                    }))
                  }
                />
                <span className="checkmark"></span>
              </label>
            </div>
          </div>
          <p style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "24px", marginBottom: "16px", marginTop: "-4px" }}>
            Adds "Discord Server" and "Website" buttons to your status.
          </p>
        </>
      )}
    </section>
  );
}
