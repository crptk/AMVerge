import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GeneralSettings } from "../settings/generalSettings";

export default function useDiscordRPC(generalSettings: GeneralSettings, activePage: string) {
  const isStartedRef = useRef(false);

  const startRPC = useCallback(async () => {
    if (isStartedRef.current) return;
    try {
      await invoke("start_discord_rpc");
      isStartedRef.current = true;
      console.log("Discord RPC started");

      // Initial status
      updateRPC({
        type: "update",
        details: "Ready to process videos",
        state: "Idle",
      });
    } catch (err) {
      console.error("Failed to start Discord RPC:", err);
    }
  }, []);

  const stopRPC = useCallback(async () => {
    if (!isStartedRef.current) return;
    try {
      await invoke("stop_discord_rpc");
      isStartedRef.current = false;
      console.log("Discord RPC stopped");
    } catch (err) {
      console.error("Failed to stop Discord RPC:", err);
    }
  }, []);

  const updateRPC = useCallback(async (data: any) => {
    if (!isStartedRef.current || !generalSettings.enableDiscordRPC) return;
    try {
      await invoke("update_discord_rpc", { data });
    } catch (err) {
      // If it fails, maybe it crashed? reset ref
      console.error("Failed to update Discord RPC:", err);
      // isStartedRef.current = false;
    }
  }, [generalSettings.enableDiscordRPC]);

  // Handle start/stop based on setting
  useEffect(() => {
    if (generalSettings.enableDiscordRPC) {
      startRPC();
    } else {
      stopRPC();
    }

    return () => {
      stopRPC();
    };
  }, [generalSettings.enableDiscordRPC, startRPC, stopRPC]);

  // Update status based on page navigation
  useEffect(() => {
    if (!isStartedRef.current || !generalSettings.enableDiscordRPC) return;

    let details = "Navigating menus";
    let state = "Idle";
    let small_image = "menu_icon_new";
    let small_text = "Browsing";

    if (activePage === "home") {
      details = "Editing Episode";
      state = "Ready";
      small_image = "edit_icon_new";
      small_text = "Editing";
    } else if (activePage === "menu") {
      details = "In Main Menu";
      state = "Selecting Episode";
      small_image = "menu_icon_new";
      small_text = "Menu";
    } else if (activePage === "settings") {
      details = "Adjusting Settings";
      state = "Preferences";
      small_image = "settings_icon_new";
      small_text = "Settings";
    }

    const buttons = [];
    if (generalSettings.rpcShowButtons) {
      buttons.push({ label: "Discord Server", url: "https://discord.gg/asJkqwqb" });
      buttons.push({ label: "Website", url: "https://amverge.app/" });
    }

    updateRPC({
      type: "update",
      details,
      state,
      large_image: "amverge_logo",
      small_image: generalSettings.rpcShowMiniIcons ? small_image : undefined,
      small_text: generalSettings.rpcShowMiniIcons ? small_text : undefined,
      buttons: generalSettings.rpcShowButtons,
    });
  }, [activePage, generalSettings, updateRPC]);

  return {
    updateRPC,
  };
}
