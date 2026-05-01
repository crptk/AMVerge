import { useEffect, useMemo, useRef, useState } from "react";
import { FaCopy, FaTrashAlt } from "react-icons/fa";
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
    <section className="panel menu-panel">
      <div className="console-header">
        <div>
          <h3>Console</h3>
          <p>Copy these logs when reporting bugs or crashes.</p>
        </div>

        <div className="console-actions">
          <button
            className="console-action-icon"
            type="button"
            onClick={handleCopy}
            aria-label="Copy Logs"
            title="Copy Logs"
          >
            <FaCopy aria-hidden="true" />
          </button>
          <button
            className="console-action-icon"
            type="button"
            onClick={handleClear}
            aria-label="Clear Logs"
            title="Clear Logs"
          >
            <FaTrashAlt aria-hidden="true" />
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
