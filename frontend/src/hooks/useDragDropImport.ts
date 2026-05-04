import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useUIStateStore } from "../stores/UIStore";

type UseDragDropImportProps = {
  handleImport: (file: string) => void | Promise<void>;
  handleBatchImport: (files: string[]) => void | Promise<void>;
};

export default function useDragDropImport({
  handleImport,
  handleBatchImport,
}: UseDragDropImportProps) {
  const lastExternalDropRef = useRef<{ path: string; ts: number } | null>(null);
  const setIsDragging = useUIStateStore((state) => state.setIsDragging);

  // Use refs for handlers to avoid restarting the effect if they change
  const handlersRef = useRef({ handleImport, handleBatchImport });
  useEffect(() => {
    handlersRef.current = { handleImport, handleBatchImport };
  }, [handleImport, handleBatchImport]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      const type = event.payload.type;

      if (type === "over") {
        const paths = (event.payload as { paths?: string[] }).paths;
        const hasPaths = Array.isArray(paths) && paths.length > 0;
        setIsDragging(hasPaths);
        return;
      }

      if (type === "drop") {
        setIsDragging(false);

        const paths = event.payload.paths;
        if (!paths || paths.length === 0) return;

        const now = Date.now();
        const last = lastExternalDropRef.current;

        if (last && last.path === paths[0] && now - last.ts < 500) return;

        lastExternalDropRef.current = { path: paths[0], ts: now };

        const videoExtensions = ["mp4", "mkv", "mov"];

        const videoFiles = paths.filter((path: string) => {
          const ext = path.split(".").pop()?.toLowerCase() || "";
          return videoExtensions.includes(ext);
        });

        if (videoFiles.length === 0) return;

        if (videoFiles.length === 1) {
          void handlersRef.current.handleImport(videoFiles[0]);
        } else {
          void handlersRef.current.handleBatchImport(videoFiles);
        }

        return;
      }

      setIsDragging(false);
    });

    void unlistenPromise.then((stop) => {
      if (disposed) {
        stop();
        return;
      }

      unlisten = stop;
    });

    return () => {
      disposed = true;
      setIsDragging(false);

      if (unlisten) {
        unlisten();
        return;
      }

      void unlistenPromise.then((stop) => stop());
    };
  }, [setIsDragging]);
}