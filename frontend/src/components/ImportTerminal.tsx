import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";

interface ImportTerminalProps {
  progress: number;
  progressMsg: string;
  batchTotal: number;
  batchDone: number;
  batchCurrentFile: string;
  onAbort: () => void;
  /** Video file name for the synthesized command header line. */
  commandLabel?: string;
}

type LineKind = "cmd" | "log" | "warn" | "error" | "event";

interface TerminalLine {
  id: number;
  kind: LineKind;
  text: string;
}

interface ConsoleLogEvent {
  source: "frontend" | "rust" | "python" | "system";
  level: "log" | "warn" | "error";
  message: string;
}

interface ClipReadyEvent {
  scene_index: number;
  clip_path: string | null;
  clip_mode: string;
}

// Braille spinner frames — same family the rich CLI progress uses in a real TTY.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 30;
const MAX_LINES = 500;

// Rust re-emits every PROGRESS| event as a "PROGRESS xx% - msg" console line.
// Those are represented by the live bar, so keep them out of the scroll log.
const isProgressEcho = (msg: string) => /^PROGRESS\s+\d/.test(msg.trim());

function fileNameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ImportTerminal({
  progress,
  progressMsg,
  batchTotal,
  batchDone,
  batchCurrentFile,
  onAbort,
  commandLabel,
}: ImportTerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(0);
  const startedRef = useRef<number>(Date.now());
  const headerPushedRef = useRef(false);

  const pushLine = (kind: LineKind, text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: idRef.current++, kind, text }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  };

  // Seed the synthesized command header once. Guarded so React StrictMode's
  // double-invoked mount effect can't push it twice.
  useEffect(() => {
    if (headerPushedRef.current) return;
    headerPushedRef.current = true;
    const target = commandLabel ? `"${commandLabel}"` : "<video>";
    pushLine("cmd", `amverge backend ${target} transnetv2_gpu video_files`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream CLI stderr lines + clip/phase events while the import runs.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    const attach = async () => {
      const stops = await Promise.all([
        listen<ConsoleLogEvent>("console_log", (e: Event<ConsoleLogEvent>) => {
          const { source, level, message } = e.payload;
          if (source !== "python") return;
          if (!message.trim() || isProgressEcho(message)) return;
          pushLine(level === "log" ? "log" : level, message);
        }),
        listen<ClipReadyEvent>("clip_ready", (e: Event<ClipReadyEvent>) => {
          const { scene_index, clip_path, clip_mode } = e.payload;
          const name = clip_path ? fileNameOf(clip_path) : `scene_${scene_index}`;
          pushLine("event", `✓ ${name} · ${clip_mode || "done"}`);
        }),
        listen("phase1_complete", () => {
          pushLine("event", "phase 1 complete · keyframe clips ready");
        }),
      ]);

      if (disposed) {
        stops.forEach((s) => s());
        return;
      }
      unlisteners.push(...stops);
    };

    attach();

    return () => {
      disposed = true;
      unlisteners.forEach((stop) => stop());
    };
  }, []);

  // Spinner + elapsed timer tick.
  useEffect(() => {
    const spin = window.setInterval(
      () => setSpinnerFrame((f) => (f + 1) % SPINNER.length),
      90
    );
    const clock = window.setInterval(
      () => setElapsed(Date.now() - startedRef.current),
      250
    );
    return () => {
      window.clearInterval(spin);
      window.clearInterval(clock);
    };
  }, []);

  // Keep the newest line in view.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines]);

  const clamped = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const barFilled = "━".repeat(filled);
  const barEmpty = "─".repeat(BAR_WIDTH - filled);
  const done = clamped >= 100;

  return (
    <div className="loading-overlay">
      <div className="import-terminal" role="log" aria-label="AMVerge CLI output">
        <div className="it-body" ref={bodyRef}>
          {lines.map((line) => (
            <div key={line.id} className={`it-line it-line-${line.kind}`}>
              {line.kind === "cmd" && <span className="it-prompt">$ </span>}
              {line.text}
            </div>
          ))}
        </div>

        <div className="it-live">
          <div className="it-status">
            <span className="it-spinner">{done ? "✓" : SPINNER[spinnerFrame]}</span>
            <span className="it-stage">{progressMsg || "Working…"}</span>
          </div>
          <div className="it-progress">
            <span className="it-bar">
              <span className="it-bar-filled">{barFilled}</span>
              <span className="it-bar-empty">{barEmpty}</span>
            </span>
            <span className="it-pct">{clamped}%</span>
            <span className="it-elapsed">{formatElapsed(elapsed)}</span>
          </div>

          {batchTotal > 1 && (
            <div className="it-batch">
              Cutting videos {batchDone + 1}/{batchTotal} · {batchCurrentFile}
            </div>
          )}

          <button className="abort-button it-abort" onClick={onAbort}>
            Abort
          </button>
        </div>
      </div>
    </div>
  );
}
