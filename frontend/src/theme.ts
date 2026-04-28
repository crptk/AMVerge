import { convertFileSrc } from "@tauri-apps/api/core";

export type ThemeSettings = {
  accentColor: string; // hex, e.g. "#22c55e"
  backgroundGradientColor: string; // hex, e.g. "#001a00"
  backgroundImagePath: string | null;
  backgroundOpacity: number; // 0 to 1
  backgroundBlur: number; // pixels
};

const STORAGE_KEY = "amverge.theme.v2";

const DEFAULTS: ThemeSettings = {
  accentColor: "#22c55e",
  backgroundGradientColor: "#001a00",
  backgroundImagePath: null,
  backgroundOpacity: 1.0,
  backgroundBlur: 0,
};

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

export function loadThemeSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Check for v1 migration if needed, but here we just return defaults for simplicity
      // or handle the old key if it exists.
      const oldRaw = localStorage.getItem("amverge.theme.v1");
      if (oldRaw) {
        const oldParsed = JSON.parse(oldRaw);
        return {
          ...DEFAULTS,
          accentColor: oldParsed.accentColor || DEFAULTS.accentColor,
          backgroundGradientColor: oldParsed.backgroundGradientColor || DEFAULTS.backgroundGradientColor,
        };
      }
      return DEFAULTS;
    }

    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      accentColor:
        typeof parsed.accentColor === "string" ? parsed.accentColor : DEFAULTS.accentColor,
      backgroundGradientColor:
        typeof parsed.backgroundGradientColor === "string"
          ? parsed.backgroundGradientColor
          : typeof parsed.accentColor === "string"
            ? parsed.accentColor
            : DEFAULTS.backgroundGradientColor,
      backgroundImagePath:
        typeof parsed.backgroundImagePath === "string"
          ? parsed.backgroundImagePath
          : null,
      backgroundOpacity:
        typeof parsed.backgroundOpacity === "number"
          ? parsed.backgroundOpacity
          : DEFAULTS.backgroundOpacity,
      backgroundBlur:
        typeof parsed.backgroundBlur === "number"
          ? parsed.backgroundBlur
          : DEFAULTS.backgroundBlur,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveThemeSettings(next: ThemeSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

  const bgValue = settings.backgroundImagePath
    ? `url("${convertFileSrc(settings.backgroundImagePath)}")`
    : "none";
  
  root.style.setProperty("--app-bg-image", bgValue);
  body.style.setProperty("--app-bg-image", bgValue);
  
  root.style.setProperty("--app-bg-opacity", String(settings.backgroundOpacity));
  body.style.setProperty("--app-bg-opacity", String(settings.backgroundOpacity));
  
  root.style.setProperty("--app-bg-blur", `${settings.backgroundBlur}px`);
  body.style.setProperty("--app-bg-blur", `${settings.backgroundBlur}px`);
}
