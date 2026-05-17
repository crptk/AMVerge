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

function stringifyConsoleArg(arg: unknown): string {
  if (typeof arg === "string") return arg;

  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
}

function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) return "";

  const [first, ...rest] = args;
  if (typeof first !== "string") {
    return args.map(stringifyConsoleArg).join(" ");
  }

  let restIndex = 0;
  const formatted = first.replace(/%[%sdifoOc]/g, (token) => {
    if (token === "%%") return "%";

    const value = rest[restIndex++];
    if (token === "%c") {
      // CSS styling token used by browser console; ignore style value in log text.
      return "";
    }
    if (value === undefined) return token;
    return stringifyConsoleArg(value);
  });

  const trailing = rest.slice(restIndex).map(stringifyConsoleArg);
  return trailing.length > 0 ? `${formatted} ${trailing.join(" ")}` : formatted;
}

function notify() {
  listeners.forEach((listener) => listener([...logs]));
}

export function getConsoleLogsSnapshot(): ConsoleEntry[] {
  return [...logs];
}

export function serializeConsoleLogs(entries: ConsoleEntry[]): string {
  return entries
    .map((log) => `[${log.time}] [${log.source}] [${log.level}] ${log.message}`)
    .join("\n");
}

export function addConsoleLog(
  source: ConsoleEntry["source"],
  level: ConsoleEntry["level"],
  args: unknown[]
) {
  const message = formatConsoleArgs(args);

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