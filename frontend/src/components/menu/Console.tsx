import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearConsoleLogs,
  subscribeToConsoleLogs,
  type ConsoleEntry,
} from "../../utils/appConsole";

export default function Console() {
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeToConsoleLogs(setLogs);
  }, []);

  const consoleText = useMemo(() => {
    return logs
      .map((log) => `[${log.time}] [${log.source}] [${log.level}] ${log.message}`)
      .join("\n");
  }, [logs]);


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(consoleText || "No console logs yet.");
  };

  const handleClear = () => {
    clearConsoleLogs();
  };

  return (
    <section className="console-section">
      <div className="console-header">
        <div>
          <h3>Console</h3>
          <p>Copy these logs when reporting bugs or crashes.</p>
        </div>

        <div className="console-actions">
          <button className="buttons" type="button" onClick={handleCopy}>
            Copy Logs
          </button>
          <button className="buttons" type="button" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      <div className="console-output">
        {logs.length === 0 ? (
          <p className="console-empty">No logs yet.</p>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`console-line console-line-${log.level}`}
            >
              <span className="console-time">[{log.time}]</span>
              <span className="console-source">[{log.source}]</span>
              <span className="console-level">[{log.level}]</span>
              <span className="console-message">{log.message}</span>
            </div>
          ))
        )}

        <div ref={bottomRef} />
      </div>
    </section>
  );
}