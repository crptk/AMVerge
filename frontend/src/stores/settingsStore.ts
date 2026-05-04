import { create } from "zustand";
import { persist } from "zustand/middleware";

/*====================
    GENERAL SETTINGS 
=====================*/
export type ExportFormat = "mp4" | "mkv" | "mov" | "avi" | "xml";

export type GeneralSettings = {
    episodesPath: string | null;
    exportFormat: "mp4" | "mkv" | "mov" | "avi" | "xml";
    exportPath: string | null;
    audioPlaybackHover: boolean;
    playbackVolume: number;
    discordRPCEnabled: boolean;
    rpcShowFilename: boolean;
    rpcShowButtons: boolean;
    rpcShowMiniIcons: boolean;
    enableEditor: boolean;
};

export type GeneralSettingsStore = GeneralSettings & {
    setEpisodesPath: (path: string | null) => void;
    setExportFormat: (format: ExportFormat) => void;
    setExportPath: (path: string | null) => void;
    setAudioPlaybackHover: (enabled: boolean) => void;
    setPlaybackVolume: (volume: number) => void;
    setDiscordRPCEnabled: (enabled: boolean) => void;
    setRpcShowFilename: (enabled: boolean) => void;
    setRpcShowButtons: (enabled: boolean) => void;
    setRpcShowMiniIcons: (enabled: boolean) => void;
    setEnableEditor: (enabled: boolean) => void;
    resetGeneralSettings: () => void;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
    episodesPath: null,
    exportFormat: "mp4",
    exportPath: null,
    audioPlaybackHover: false,
    playbackVolume: 0.2,
    discordRPCEnabled: true,
    rpcShowFilename: true,
    rpcShowButtons: true,
    rpcShowMiniIcons: true,
    enableEditor: true
};

export const useGeneralSettingsStore = create<GeneralSettingsStore>()(
    persist(
        (set) => ({
            ...DEFAULT_GENERAL_SETTINGS,

            setEpisodesPath: (path) => set({ episodesPath: path }),
            setExportFormat: (format) => set({ exportFormat: format }),
            setExportPath: (path) => set({ exportPath: path }),
            setAudioPlaybackHover: (enabled) =>
                set({ audioPlaybackHover: enabled }),
            setPlaybackVolume: (volume) => set({ playbackVolume: volume }),
            setDiscordRPCEnabled: (enabled) =>
                set({ discordRPCEnabled: enabled }),
            setRpcShowFilename: (enabled) =>
                set({ rpcShowFilename: enabled }),
            setRpcShowButtons: (enabled) =>
                set({ rpcShowButtons: enabled }),
            setRpcShowMiniIcons: (enabled) =>
                set({ rpcShowMiniIcons: enabled }),
            setEnableEditor: (enabled) =>
                set({ enableEditor: enabled }),

            resetGeneralSettings: () => set(DEFAULT_GENERAL_SETTINGS),
        }),
        {
            name: "amverge.generalSettings.v2",
        }
    )
);

/*====================
    THEME SETTINGS 
=====================*/
import { convertFileSrc } from "@tauri-apps/api/core";

export type ThemeSettings = {
    accentColor: string; // hex, e.g. "#22c55e"
    backgroundGradientColor: string; // hex, e.g. "#001a00"
    backgroundImagePath: string | null;
    backgroundOpacity: number; // 0 to 1
    backgroundBlur: number; // pixels
    showDownloadButton: boolean;
};

export type ThemeSettingsStore = ThemeSettings & {
    setAccentColor: (accent: string) => void;
    setBackgroundGradientColor: (gradientColor: string) => void;
    setBackgroundImagePath: (imagePath: string | null) => void;
    setBackgroundOpacity: (opacity: number) => void;
    setBackgroundBlur: (blur: number) => void;
    setShowDownloadButton: (showDownloadButton: boolean) => void;
    resetThemeSettings: () => void;
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
    accentColor: "#22c55e",
    backgroundGradientColor: "#001a00",
    backgroundImagePath: null,
    backgroundOpacity: 1.0,
    backgroundBlur: 0,
    showDownloadButton: true,
};

export const useThemeSettingsStore = create<ThemeSettingsStore>()(
    persist(
        (set) => ({
            ...DEFAULT_THEME_SETTINGS,

            setAccentColor: (accent) => {
                console.log("Accent color setting..");
                set({ accentColor: accent });
            },
            setBackgroundGradientColor: (gradientColor) => {
                console.log("Background gradient changing..")
                set({ backgroundGradientColor: gradientColor })
            },
            setBackgroundImagePath: (imagePath) => {
                console.log("Changing background image...")
                set({ backgroundImagePath: imagePath })
            },
            setBackgroundOpacity: (opacity) => {
                console.log("Setting background opacity..")
                set({ backgroundOpacity: opacity })
            },
            setBackgroundBlur: (blur) => {
                console.log("Setting background blur..")
                set({ backgroundBlur: blur })
            },
            setShowDownloadButton: (showDownloadButton) => {
                console.log("Toggling download button..")
                set({ showDownloadButton: showDownloadButton })
            },
            resetThemeSettings: () => {
                console.log("Resetting theme..")
                set({ ...DEFAULT_THEME_SETTINGS })
            },
        }),
        {
            name: "amverge.theme.v2",
        }
    )
);

function clampByte(value: number) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgbTriplet(hex: string): string | null {
    const cleaned = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;

    const r = clampByte(parseInt(cleaned.slice(0, 2), 16));
    const g = clampByte(parseInt(cleaned.slice(2, 4), 16));
    const b = clampByte(parseInt(cleaned.slice(4, 6), 16));

    // css color 4 slash syntax
    return `${r} ${g} ${b}`;
}

export function applyThemeSettings(settings: ThemeSettings) {
    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty("--accent", settings.accentColor);
    body.style.setProperty("--accent", settings.accentColor);

    root.style.setProperty("--bg-accent", settings.backgroundGradientColor);
    body.style.setProperty("--bg-accent", settings.backgroundGradientColor);

    const rgb = hexToRgbTriplet(settings.accentColor);
    if (rgb) {
        root.style.setProperty("--accent-rgb", rgb);
        body.style.setProperty("--accent-rgb", rgb);
    }

    let bgValue = "none";
    if (settings.backgroundImagePath) {
        const [cleanPath, query] = settings.backgroundImagePath.split("?");
        const src = convertFileSrc(cleanPath);
        bgValue = query ? `url("${src}?${query}")` : `url("${src}")`;
    }

    root.style.setProperty("--app-bg-image", bgValue);
    body.style.setProperty("--app-bg-image", bgValue);

    root.style.setProperty("--app-bg-opacity", String(settings.backgroundOpacity));
    body.style.setProperty("--app-bg-opacity", String(settings.backgroundOpacity));

    root.style.setProperty("--app-bg-blur", `${settings.backgroundBlur}px`);
    body.style.setProperty("--app-bg-blur", `${settings.backgroundBlur}px`);
}

export function getDarkerColor(hex: string, factor = 0.5): string {
    const cleaned = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return "#000000";

    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);

    const dr = clampByte(r * factor);
    const dg = clampByte(g * factor);
    const db = clampByte(b * factor);

    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
}