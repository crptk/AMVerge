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
    const [{ check }, { confirm, message }] = await Promise.all([
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

    console.log(`[updater] starting install for v${update.version}`);
    await update.downloadAndInstall();
    console.log(`[updater] install finished for v${update.version}`);

    await message(
      `Update v${update.version} was installed.`,
      { title: "AMVerge Update Installed" },
    );
  } catch (error) {
    // Show a visible error instead of silently dismissing the update flow.
    const [{ message }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
    ]);

    const errorText = error instanceof Error ? error.message : "Update download/install failed.";
    console.error("[updater] update flow failed:", error);
    await message(
      `Could not install the update. ${errorText}`,
      { title: "AMVerge Update Failed" },
    );
  }
}

void maybeCheckForUpdatesOnStartup();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
