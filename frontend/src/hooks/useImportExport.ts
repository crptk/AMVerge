import { useState, useRef, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ClipItem, EpisodeEntry } from "../types/domain"
import { fileNameFromPath, truncateFileName, detectScenes } from "../utils/episodeUtils";
import { useGeneralSettingsStore } from "../store/settingsStore";
import { useAppStateStore } from "../store/appStore";

type ImportExportProps = {
  abortedRef: React.RefObject<boolean>;
  EXPORT_DIR_STORAGE_KEY: string;
  exportDir: string | null;
  setExportDir: React.Dispatch<React.SetStateAction<string | null>>;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
  setProgressMsg: React.Dispatch<React.SetStateAction<string>>;
  exportFormat: "mp4" | "mkv" | "mov" | "avi" | "xml";
  onRPCUpdate?: (data: any) => void;
};

export default function useImportExport(props: ImportExportProps) {
  const [loading, setLoading] = useState(false);
  const [importToken, setImportToken] = useState(() => Date.now().toString());
  const importGenRef = useRef(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [batchCurrentFile, setBatchCurrentFile] = useState("");

  // General settings 
  const rpcShowButtons = useGeneralSettingsStore(s => s.rpcShowButtons);
  const rpcShowFileName = useGeneralSettingsStore(s => s.rpcShowFilename);
  const rpcShowMiniIcons = useGeneralSettingsStore(s => s.rpcShowMiniIcons); 
  const episodesPath = useGeneralSettingsStore(s => s.episodesPath);

  // App states
  const clips = useAppStateStore((s) => s.clips);
  const setClips = useAppStateStore((s) => s.setClips);

  const setFocusedClip = useAppStateStore((s) => s.setFocusedClip);
  const setSelectedClips = useAppStateStore((s) => s.setSelectedClips);
  const setEpisodes = useAppStateStore((s) => s.setEpisodes);
  const setSelectedEpisodeId = useAppStateStore((s) => s.setSelectedEpisodeId);
  const setOpenedEpisodeId = useAppStateStore((s) => s.setOpenedEpisodeId);
  const setImportedVideoPath = useAppStateStore((s) => s.setImportedVideoPath);
  const setVideoIsHEVC = useAppStateStore((s) => s.setVideoIsHEVC);

  const selectedFolderId = useAppStateStore((s) => s.selectedFolderId);

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
      setSelectedClips(new Set());
      setFocusedClip(null);
      setImportedVideoPath(file);
      setVideoIsHEVC(null);
      setImportToken(Date.now().toString());

      const rpcButtons = [];
      if (rpcShowButtons) {
        rpcButtons.push({ label: "Discord Server", url: "https://discord.gg/asJkqwqb" });
        rpcButtons.push({ label: "Website", url: "https://amverge.app/" });
      }

      props.onRPCUpdate?.({
        type: "update",
        details: `Detecting: ${rpcShowFileName ? fileNameFromPath(file) : "Video"}`,
        state: "Processing Video",
        large_image: "amverge_logo",
        small_image: rpcShowMiniIcons ? "loading_icon_new" : undefined,
        small_text: rpcShowMiniIcons ? "Detecting..." : undefined,
        buttons: rpcShowButtons,
      });

      const formatted = await detectScenes(file, episodeId, episodesPath);

      // A newer import started while we were waiting - discard stale results.
      if (importGenRef.current !== gen) return;

      const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

      const episodeEntry: EpisodeEntry = {
        id: episodeId,
        displayName: inferredName,
        videoPath: file,
        folderId: selectedFolderId,
        importedAt: Date.now(),
        clips: formatted,
      };

      setEpisodes((prev) => [episodeEntry, ...prev]);
      setSelectedEpisodeId(episodeId);
      setOpenedEpisodeId(episodeId);
      startTransition(() => {
        setClips(formatted);
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
      setSelectedClips(new Set());
      setFocusedClip(null);
      setVideoIsHEVC(null);
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
          const formatted = await detectScenes(file, episodeId, episodesPath);

          if (props.abortedRef.current || importGenRef.current !== gen) {
            // Aborted or superseded mid-flight — clean up this episode's cache
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: episodesPath,
            }).catch(() => { });
            break;
          }

          const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

          const episodeEntry: EpisodeEntry = {
            id: episodeId,
            displayName: inferredName,
            videoPath: file,
            folderId: selectedFolderId,
            importedAt: Date.now(),
            clips: formatted,
          };

          completedEpisodes.push(episodeEntry);
          setEpisodes((prev) => [episodeEntry, ...prev]);
        } catch (err) {
          if (props.abortedRef.current) {
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: episodesPath,
            }).catch(() => { });
            break;
          }
          console.error(`Detection failed for ${fileName}:`, err);
          invoke("delete_episode_cache", {
            episodeCacheId: episodeId,
            customPath: episodesPath,
          }).catch(() => { });
        }
      }

      // Open the first completed episode
      if (completedEpisodes.length > 0 && importGenRef.current === gen) {
        const first = completedEpisodes[0];
        setSelectedEpisodeId(first.id);
        setOpenedEpisodeId(first.id);
        setImportedVideoPath(first.videoPath);
        setImportToken(Date.now().toString());
        startTransition(() => {
          setClips(first.clips);
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

  const handleExport = async (selectedClips: Set<string>, mergeEnabled: boolean, mergeFileName?: string) => {
    if (selectedClips.size === 0) return;

    const selected = clips.filter((c: ClipItem) => selectedClips.has(c.id));
    if (selected.length === 0) return;

    // If no export directory is set, prompt the user to pick one first
    let dir = props.exportDir;
    if (!dir) {
      const picked = await open({ directory: true, multiple: false });
      if (!picked) return;
      dir = picked as string;
      props.setExportDir(dir);
    }

    try {
      setLoading(true);

      const clipArray = selected.map((c: ClipItem) => c.src);
      const format = props.exportFormat || "mp4";

      props.onRPCUpdate?.({
        type: "update",
        details: `Exporting ${selected.length} clips`,
        state: "Saving Progress",
        large_image: "amverge_logo",
        small_image: rpcShowMiniIcons ? "save_icon_new" : undefined,
        small_text: rpcShowMiniIcons ? "Exporting..." : undefined,
        buttons: rpcShowButtons,
      });

      if (mergeEnabled) {
        const baseName = mergeFileName || ((selected[0]?.originalName || "episode") + "_merged");
        const savePath = `${dir}\\${baseName}.${format}`;

        await invoke("export_clips", {
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

        await invoke("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: false,
        });
      }

      props.onRPCUpdate?.({
        type: "update",
        details: "Export Finished!",
        state: "Success",
        large_image: "amverge_logo",
        small_image: rpcShowMiniIcons ? "check_icon_new" : undefined,
        small_text: rpcShowMiniIcons ? "Done" : undefined,
        buttons: rpcShowButtons,
      });

      // Revert back to normal state after 10 seconds
      setTimeout(() => {
        props.onRPCUpdate?.({
          type: "update",
          details: "Editing Episode",
          state: "Ready",
          large_image: "amverge_logo",
          small_image: rpcShowMiniIcons ? "edit_icon_new" : undefined,
          small_text: rpcShowMiniIcons ? "Editing" : undefined,
          buttons: rpcShowButtons,
        });
      }, 10000);
    } catch (err) {
      console.log("Export failed:", err)
    } finally {
      setLoading(false);
    }
  };

  const handlePickExportDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) props.setExportDir(dir as string);
  };

  const handleDownloadSingleClip = async (clip: ClipItem) => {
    try {
      const format = props.exportFormat || "mp4";
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
    onImportClick,
    handleImport,
    handleExport,
    handlePickExportDir,
    handleBatchImport,
    handleDownloadSingleClip
  };
}