
const STORAGE_KEY = "amverge.generalSettings.v2"

export type GeneralSettings = {
    episodesPath: string | null;
};

export const DEFAULT_GENERAL_SETTINGS = {
    episodesPath: null
}

export function loadGeneralSettings(): GeneralSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_GENERAL_SETTINGS;
        const parsed = JSON.parse(raw) as Partial<GeneralSettings>;
        return {
            episodesPath: typeof parsed.episodesPath === "string" ? parsed.episodesPath : DEFAULT_GENERAL_SETTINGS.episodesPath,
        };
    } catch {
        return DEFAULT_GENERAL_SETTINGS;
    }
}

export function saveGeneralSettings(next: GeneralSettings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}