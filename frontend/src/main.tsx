import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { initConsoleCapture } from "./utils/appConsole";

initConsoleCapture();

async function maybeCheckForUpdatesOnStartup() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  try {
    const [{ check }, { confirm }] = await Promise.all([
      import("@tauri-apps/plugin-updater"),
      import("@tauri-apps/plugin-dialog"),
    ]);

    const update = await check();
    if (!update) return;

    const ok = await confirm(
      `A new update is available (v${update.version}). Install now?`,
      { title: "AMVerge Update" },
    );

    if (!ok) return;

    await update.downloadAndInstall();
  } catch {
    // Swallow updater errors (offline, misconfigured endpoint/pubkey, etc.).
  }
}

void maybeCheckForUpdatesOnStartup();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
