
const STORAGE_KEY = "amverge.generalSettings.v2"

export type GeneralSettings = {
    episodesPath: string | null;
    exportFormat: "mp4" | "mkv" | "mov" | "avi" | "xml";
    audioPlaybackHover: boolean;
    playbackVolume: number;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
    episodesPath: null,
    exportFormat: "mp4",
    audioPlaybackHover: true,
    playbackVolume: 0.2,
}

export function loadGeneralSettings(): GeneralSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_GENERAL_SETTINGS;
        const parsed = JSON.parse(raw) as Partial<GeneralSettings>;
        return {
            episodesPath: typeof parsed.episodesPath === "string" ? parsed.episodesPath : DEFAULT_GENERAL_SETTINGS.episodesPath,
            exportFormat: (["mp4", "mkv", "mov", "avi", "xml"].includes(parsed.exportFormat as any)) 
                ? (parsed.exportFormat as any) 
                : DEFAULT_GENERAL_SETTINGS.exportFormat,
            audioPlaybackHover: typeof parsed.audioPlaybackHover === "boolean" ? parsed.audioPlaybackHover : DEFAULT_GENERAL_SETTINGS.audioPlaybackHover,
            playbackVolume: typeof parsed.playbackVolume === "number" ? parsed.playbackVolume : DEFAULT_GENERAL_SETTINGS.playbackVolume,
        };
    } catch {
        return DEFAULT_GENERAL_SETTINGS;
    }
}

export function saveGeneralSettings(next: GeneralSettings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}