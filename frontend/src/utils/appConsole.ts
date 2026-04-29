import { listen } from "@tauri-apps/api/event";

export type ConsoleEntry = {
  id: number;
  source: "frontend" | "rust" | "python" | "system";
  level: "log" | "warn" | "error";
  message: string;
  time: string;
};

const MAX_LOGS = 500;

let logs: ConsoleEntry[] = [];
const listeners = new Set<(logs: ConsoleEntry[]) => void>();
let initialized = false;

function notify() {
  listeners.forEach((listener) => listener([...logs]));
}

export function addConsoleLog(
  source: ConsoleEntry["source"],
  level: ConsoleEntry["level"],
  args: unknown[]
) {
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;

      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  logs = [
    ...logs.slice(-(MAX_LOGS - 1)),
    {
      id: Date.now() + Math.random(),
      source,
      level,
      message,
      time: new Date().toLocaleTimeString(),
    },
  ];

  notify();
}

export function clearConsoleLogs() {
  logs = [];
  notify();
}

export function subscribeToConsoleLogs(listener: (logs: ConsoleEntry[]) => void) {
  listeners.add(listener);
  listener([...logs]);

  return () => {
    listeners.delete(listener);
  };
}

export function initConsoleCapture() {
  if (initialized) return;
  initialized = true;

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    originalLog(...args);
    addConsoleLog("frontend", "log", args);
  };

  console.warn = (...args) => {
    originalWarn(...args);
    addConsoleLog("frontend", "warn", args);
  };

  console.error = (...args) => {
    originalError(...args);
    addConsoleLog("frontend", "error", args);
  };

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    listen<{
        source: "frontend" | "rust" | "python" | "system";
        level: "log" | "warn" | "error";
        message: string;
    }>("console_log", (event) => {
        addConsoleLog(event.payload.source, event.payload.level, [
        event.payload.message,
        ]);
    }).catch((err) => {
        console.warn("Failed to attach Tauri console listener", err);
    });
  }
  addConsoleLog("system", "log", ["AMVerge console started."]);
}