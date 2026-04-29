import { useState, useRef, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ClipItem, EpisodeEntry } from "../types/domain"
import { fileNameFromPath, truncateFileName, detectScenes } from "../utils/episodeUtils";
export type EditorTarget = "premiere" | "after_effects" | "davinci_resolve";
import { GeneralSettings } from "../settings/generalSettings";

type ImportExportProps = {
  abortedRef: React.RefObject<boolean>;
  clips: ClipItem[];
  setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>;
  setVideoIsHEVC: React.Dispatch<React.SetStateAction<boolean | null>>;
  setImportedVideoPath: React.Dispatch<React.SetStateAction<string | null>>;
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  setEpisodes: React.Dispatch<React.SetStateAction<EpisodeEntry[]>>;
  setSelectedEpisodeId: React.Dispatch<React.SetStateAction<string | null>>;
  setOpenedEpisodeId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedFolderId: string | null;
  EXPORT_DIR_STORAGE_KEY: string;
  exportDir: string | null;
  setExportDir: React.Dispatch<React.SetStateAction<string | null>>;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
  setProgressMsg: React.Dispatch<React.SetStateAction<string>>;
  episodesPath: string | null;
  exportFormat: "mp4" | "mkv" | "mov" | "avi" | "xml";
  onRPCUpdate?: (data: any) => void;
  generalSettings: GeneralSettings;
};

export default function useImportExport(props: ImportExportProps) {
  const [loading, setLoading] = useState(false);
  const [importToken, setImportToken] = useState(() => Date.now().toString());
  const importGenRef = useRef(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [batchCurrentFile, setBatchCurrentFile] = useState("");
  const [showLoaderCancel, setShowLoaderCancel] = useState(false);
  const [loaderCancelLabel, setLoaderCancelLabel] = useState("Cancel");

  const editorLabel = (target: EditorTarget): string => {
    if (target === "after_effects") return "After Effects";
    if (target === "davinci_resolve") return "DaVinci Resolve";
    return "Premiere Pro";
  };

  const formatAutoImportFailureMessage = (
    target: EditorTarget,
    rawError: unknown
  ): string => {
    const details = String(rawError ?? "Unknown error")
      .replace(/^Error:\s*/i, "")
      .split("\n")[0]
      .trim();

    if (/AMVERGE_CANCELED/i.test(details) || /canceled by user/i.test(details)) {
      return "Export completed. Auto-import canceled.";
    }

    if (/executable was not found/i.test(details)) {
      return `Export complete. ${editorLabel(target)} was not detected.`;
    }

    if (details) {
      return `Export completed. Auto-import failed: ${details}`;
    }

    return "Export completed. Auto-import failed (see Console).";
  };

  const handleCancelLoaderTask = async () => {
    if (!showLoaderCancel) return;

    try {
      setLoaderCancelLabel("Canceling...");
      props.setProgressMsg("Canceling auto-import...");
      await invoke("abort_editor_import");
    } catch (err) {
      console.warn("abort_editor_import failed:", err);
    }
  };
  const onImportClick = async () => {
    const files = await open({
      multiple: true,
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mkv", "mov", "avi"]
        }
      ]
    });

    if (!files) return;

    // open() with multiple:true returns string[] | null
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return;

    if (fileList.length === 1) {
      handleImport(fileList[0]);
    } else {
      handleBatchImport(fileList);
    }
  }

  const handleImport = async (file: string | null) => {
    // This opens the file dialog to select a video file
    if (!file) return;

    const episodeId = crypto.randomUUID();
    const gen = ++importGenRef.current;

    try {
      props.setProgress(0);
      props.setProgressMsg("Starting...");
      setLoading(true);
      props.setSelectedClips(new Set());
      props.setFocusedClip(null);
      props.setImportedVideoPath(file);
      props.setVideoIsHEVC(null);
      setImportToken(Date.now().toString());

      const rpcButtons: { label: string; url: string }[] = [];
      if (props.generalSettings.rpcShowButtons) {
        rpcButtons.push({ label: "Discord Server", url: "https://discord.gg/asJkqwqb" });
        rpcButtons.push({ label: "Website", url: "https://amverge.app/" });
      }

      props.onRPCUpdate?.({
        type: "update",
        details: `Detecting: ${props.generalSettings.rpcShowFilename ? fileNameFromPath(file) : "Video"}`,
        state: "Processing Video",
        large_image: "amverge_logo",
        small_image: props.generalSettings.rpcShowMiniIcons ? "loading_icon_new" : undefined,
        small_text: props.generalSettings.rpcShowMiniIcons ? "Detecting..." : undefined,
        buttons: props.generalSettings.rpcShowButtons ? rpcButtons : undefined,
      });

      const formatted = await detectScenes(file, episodeId, props.episodesPath);

      // A newer import started while we were waiting - discard stale results.
      if (importGenRef.current !== gen) return;

      const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

      const episodeEntry: EpisodeEntry = {
        id: episodeId,
        displayName: inferredName,
        videoPath: file,
        folderId: props.selectedFolderId,
        importedAt: Date.now(),
        clips: formatted,
      };

      props.setEpisodes((prev) => [episodeEntry, ...prev]);
      props.setSelectedEpisodeId(episodeId);
      props.setOpenedEpisodeId(episodeId);
      startTransition(() => {
        props.setClips(formatted);
      });
    } catch (err) {
      if (importGenRef.current !== gen) return;
      console.error("Detection failed:", err);
    } finally {
      if (importGenRef.current === gen) setLoading(false);
    }
  };

  const handleBatchImport = async (files: string[]) => {
    const gen = ++importGenRef.current;
    props.abortedRef.current = false;

    const completedEpisodes: EpisodeEntry[] = [];

    try {
      props.setProgress(0);
      props.setProgressMsg("Starting...");
      setLoading(true);
      props.setSelectedClips(new Set());
      props.setFocusedClip(null);
      props.setVideoIsHEVC(null);
      setBatchTotal(files.length);
      setBatchDone(0);
      setBatchCurrentFile("");

      for (let i = 0; i < files.length; i++) {
        if (props.abortedRef.current) break;
        if (importGenRef.current !== gen) return;

        const file = files[i];
        const episodeId = crypto.randomUUID();
        const fileName = fileNameFromPath(file);

        setBatchDone(i);
        setBatchCurrentFile(truncateFileName(fileName));
        props.setProgress(0);
        props.setProgressMsg("Starting...");

        try {
          const formatted = await detectScenes(file, episodeId, props.episodesPath);

          if (props.abortedRef.current || importGenRef.current !== gen) {
            // Aborted or superseded mid-flight — clean up this episode's cache
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: props.episodesPath,
            }).catch(() => { });
            break;
          }

          const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

          const episodeEntry: EpisodeEntry = {
            id: episodeId,
            displayName: inferredName,
            videoPath: file,
            folderId: props.selectedFolderId,
            importedAt: Date.now(),
            clips: formatted,
          };

          completedEpisodes.push(episodeEntry);
          props.setEpisodes((prev) => [episodeEntry, ...prev]);
        } catch (err) {
          if (props.abortedRef.current) {
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: props.episodesPath,
            }).catch(() => { });
            break;
          }
          console.error(`Detection failed for ${fileName}:`, err);
          invoke("delete_episode_cache", {
            episodeCacheId: episodeId,
            customPath: props.episodesPath,
          }).catch(() => { });
        }
      }

      // Open the first completed episode
      if (completedEpisodes.length > 0 && importGenRef.current === gen) {
        const first = completedEpisodes[0];
        props.setSelectedEpisodeId(first.id);
        props.setOpenedEpisodeId(first.id);
        props.setImportedVideoPath(first.videoPath);
        setImportToken(Date.now().toString());
        startTransition(() => {
          props.setClips(first.clips);
        });
      }
    } finally {
      if (importGenRef.current === gen) {
        setLoading(false);
        setBatchTotal(0);
        setBatchDone(0);
        setBatchCurrentFile("");
      }
    }
  };

  const handleExport = async (
    selectedClips: Set<string>,
    mergeEnabled: boolean,
    mergeFileName?: string,
    editorTarget: EditorTarget = "premiere"
  ) => {
    if (selectedClips.size === 0) return;

    const selected = props.clips.filter((c: ClipItem) => selectedClips.has(c.id));
    if (selected.length === 0) return;

    // If no export directory is set, prompt the user to pick one first
    let dir = props.exportDir;
    if (!dir) {
      const picked = await open({ directory: true, multiple: false });
      if (!picked) return;
      dir = picked as string;
      props.setExportDir(dir);
    }

    let overlayHoldMs = 0;

    try {
      setLoading(true);

      const clipArray = selected.map((c: ClipItem) => c.src);
      const format = props.exportFormat || "mp4";
      if (format === "xml") {
        props.setProgress(100);
        props.setProgressMsg(
          "Export canceled. XML is not supported in this export flow. Use MP4, MKV, MOV, or AVI."
        );
        overlayHoldMs = 1800;
        return;
      }
      let exportedPaths: string[] = [];

      const rpcButtons: { label: string; url: string }[] = [];
      if (props.generalSettings.rpcShowButtons) {
        rpcButtons.push({ label: "Discord Server", url: "https://discord.gg/asJkqwqb" });
        rpcButtons.push({ label: "Website", url: "https://amverge.app/" });
      }
      props.onRPCUpdate?.({
        type: "update",
        details: `Exporting ${selected.length} clips`,
        state: "Saving Progress",
        large_image: "amverge_logo",
        small_image: props.generalSettings.rpcShowMiniIcons ? "save_icon_new" : undefined,
        small_text: props.generalSettings.rpcShowMiniIcons ? "Exporting..." : undefined,
        buttons: props.generalSettings.rpcShowButtons ? rpcButtons : undefined,
      });

      if (mergeEnabled) {
        const baseName = mergeFileName || ((selected[0]?.originalName || "episode") + "_merged");
        const savePath = `${dir}\\${baseName}.${format}`;

        exportedPaths = await invoke<string[]>("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: mergeEnabled,
        });
      } else {
        const firstClipPath = selected[0]?.src || "";
        const firstFile = firstClipPath.split(/[/\\]/).pop() || `episode_0000.${format}`;
        const firstStem = firstFile.replace(/\.[^/.]+$/, "");
        const defaultBase = firstStem.replace(/_\d{4}$/, "");
        const savePath = `${dir}\\${defaultBase}_####.${format}`;

        exportedPaths = await invoke<string[]>("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: false,
        });
      }

      if (exportedPaths.length > 0) {
        try {
          props.setProgress(99);
          props.setProgressMsg(
            `Export finished. Preparing ${editorLabel(editorTarget)} auto-import...`
          );
          setShowLoaderCancel(true);
          setLoaderCancelLabel("Cancel");

          const result = await invoke<string>("import_media_to_editor", {
            editorTarget,
            mediaPaths: exportedPaths,
          });

          props.setProgress(100);
          props.setProgressMsg(
            result?.trim() || `${editorLabel(editorTarget)} import complete.`
          );
          console.log(result);
        } catch (err) {
          console.warn("Auto-import failed:", err);
          props.setProgress(100);
          const failureMsg = formatAutoImportFailureMessage(editorTarget, err);
          props.setProgressMsg(failureMsg);
          if (/not detected/i.test(failureMsg)) {
            // Keep the integrated loader message visible briefly so the user can read it.
            overlayHoldMs = 1800;
          }
        } finally {
          setShowLoaderCancel(false);
          setLoaderCancelLabel("Cancel");
        }
      }

      props.onRPCUpdate?.({
        type: "update",
        details: "Export Finished!",
        state: "Success",
        large_image: "amverge_logo",
        small_image: props.generalSettings.rpcShowMiniIcons ? "check_icon_new" : undefined,
        small_text: props.generalSettings.rpcShowMiniIcons ? "Done" : undefined,
        buttons: props.generalSettings.rpcShowButtons ? rpcButtons : undefined,
      });

      // Revert back to normal state after 10 seconds
      setTimeout(() => {
        props.onRPCUpdate?.({
          type: "update",
          details: "Editing Episode",
          state: "Ready",
          large_image: "amverge_logo",
          small_image: props.generalSettings.rpcShowMiniIcons ? "edit_icon_new" : undefined,
          small_text: props.generalSettings.rpcShowMiniIcons ? "Editing" : undefined,
          buttons: props.generalSettings.rpcShowButtons ? rpcButtons : undefined,
        });
      }, 10000);
    } catch (err) {
      console.log("Export failed:", err)
    } finally {
      setShowLoaderCancel(false);
      setLoaderCancelLabel("Cancel");
      if (overlayHoldMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, overlayHoldMs));
      }
      setLoading(false);
    }
  };

  const handlePickExportDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) props.setExportDir(dir as string);
  };

  const handleDownloadSingleClip = async (clip: ClipItem) => {
    try {
      const format = props.exportFormat === "xml" ? "mp4" : (props.exportFormat || "mp4");
      const fileName = clip.originalName || fileNameFromPath(clip.src);
      const defaultPath = `${fileName}.${format}`;

      const savePath = await save({
        defaultPath,
        filters: [{ name: "Video", extensions: [format] }],
      });

      if (!savePath) return;

      setLoading(true);
      await invoke("export_clips", {
        clips: [clip.src],
        savePath: savePath,
        mergeEnabled: false,
      });
      console.log("Single clip download complete");
    } catch (err) {
      console.error("Single clip download failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    importToken,
    setImportToken,
    batchTotal,
    batchDone,
    batchCurrentFile,
    showLoaderCancel,
    loaderCancelLabel,
    handleCancelLoaderTask,
    onImportClick,
    handleImport,
    handleExport,
    handlePickExportDir,
    handleBatchImport,
    handleDownloadSingleClip
  };
}
