import { useRef, startTransition, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ClipItem, EpisodeEntry } from "../types/domain"
import { fileNameFromPath, truncateFileName, detectScenes } from "../utils/episodeUtils";

import { useAppStateStore, useAppPersistedStore } from "../stores/appStore";
import { useEpisodePanelRuntimeStore } from "../stores/episodeStore";
import { useGeneralSettingsStore } from "../stores/settingsStore";

type ImportExportProps = {
  abortedRef?: React.RefObject<boolean>;
  onRPCUpdate?: (data: any) => void;
};

export default function useImportExport(props?: ImportExportProps) {
  const appState = useAppStateStore();
  const episodeState = useEpisodePanelRuntimeStore();
  const generalSettings = useGeneralSettingsStore();
  const persistedState = useAppPersistedStore();

  const loading = appState.loading;
  const setLoading = appState.setLoading;
  const importToken = appState.importToken;
  const setImportToken = appState.setImportToken;
  const batchTotal = appState.batchTotal;
  const setBatchTotal = appState.setBatchTotal;
  const batchDone = appState.batchDone;
  const setBatchDone = appState.setBatchDone;
  const batchCurrentFile = appState.batchCurrentFile;
  const setBatchCurrentFile = appState.setBatchCurrentFile;

  const importGenRef = useRef(0);
  const localAbortedRef = useRef(false);
  const abortedRef = props?.abortedRef || localAbortedRef;

  const handleImport = useCallback(async (file: string | null) => {
    if (!file) return;

    const episodeId = crypto.randomUUID();
    const gen = ++importGenRef.current;

    try {
      appState.setProgress(0);
      appState.setProgressMsg("Starting...");
      setLoading(true);
      appState.setSelectedClips(new Set());
      appState.setFocusedClip(null);
      appState.setImportedVideoPath(file);
      appState.setVideoIsHEVC(null);
      setImportToken(Date.now().toString());

      const rpcButtons = [];
      if (generalSettings.rpcShowButtons) {
        rpcButtons.push({ label: "Discord Server", url: "https://discord.gg/asJkqwqb" });
        rpcButtons.push({ label: "Website", url: "https://amverge.app/" });
      }

      props?.onRPCUpdate?.({
        type: "update",
        details: `Detecting: ${generalSettings.rpcShowFilename ? fileNameFromPath(file) : "Video"}`,
        state: "Processing Video",
        large_image: "amverge_logo",
        small_image: generalSettings.rpcShowMiniIcons ? "loading_icon_new" : undefined,
        small_text: generalSettings.rpcShowMiniIcons ? "Detecting..." : undefined,
        buttons: generalSettings.rpcShowButtons,
      });

      const formatted = await detectScenes(file, episodeId, generalSettings.episodesPath);

      if (importGenRef.current !== gen) return;

      const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

      const episodeEntry: EpisodeEntry = {
        id: episodeId,
        displayName: inferredName,
        videoPath: file,
        folderId: episodeState.selectedFolderId,
        importedAt: Date.now(),
        clips: formatted,
      };

      episodeState.setEpisodes((prev) => [episodeEntry, ...prev]);
      episodeState.setSelectedEpisodeId(episodeId);
      episodeState.setOpenedEpisodeId(episodeId);
      startTransition(() => {
        appState.setClips(formatted);
      });
    } catch (err) {
      if (importGenRef.current !== gen) return;
      console.error("Detection failed:", err);
    } finally {
      if (importGenRef.current === gen) setLoading(false);
    }
  }, [appState, episodeState, generalSettings, props?.onRPCUpdate]);

  const handleBatchImport = useCallback(async (files: string[]) => {
    const gen = ++importGenRef.current;
    abortedRef.current = false;

    const completedEpisodes: EpisodeEntry[] = [];

    try {
      appState.setProgress(0);
      appState.setProgressMsg("Starting...");
      setLoading(true);
      appState.setSelectedClips(new Set());
      appState.setFocusedClip(null);
      appState.setVideoIsHEVC(null);
      setBatchTotal(files.length);
      setBatchDone(0);
      setBatchCurrentFile("");

      for (let i = 0; i < files.length; i++) {
        if (abortedRef.current) break;
        if (importGenRef.current !== gen) return;

        const file = files[i];
        const episodeId = crypto.randomUUID();
        const fileName = fileNameFromPath(file);

        setBatchDone(i);
        setBatchCurrentFile(truncateFileName(fileName));
        appState.setProgress(0);
        appState.setProgressMsg("Starting...");

        try {
          const formatted = await detectScenes(file, episodeId, generalSettings.episodesPath);

          if (abortedRef.current || importGenRef.current !== gen) {
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: generalSettings.episodesPath,
            }).catch(() => { });
            break;
          }

          const inferredName = formatted[0]?.originalName || fileNameFromPath(file);

          const episodeEntry: EpisodeEntry = {
            id: episodeId,
            displayName: inferredName,
            videoPath: file,
            folderId: episodeState.selectedFolderId,
            importedAt: Date.now(),
            clips: formatted,
          };

          completedEpisodes.push(episodeEntry);
          episodeState.setEpisodes((prev) => [episodeEntry, ...prev]);
        } catch (err) {
          if (abortedRef.current) {
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: generalSettings.episodesPath,
            }).catch(() => { });
            break;
          }
          console.error(`Detection failed for ${fileName}:`, err);
          invoke("delete_episode_cache", {
            episodeCacheId: episodeId,
            customPath: generalSettings.episodesPath,
          }).catch(() => { });
        }
      }

      if (completedEpisodes.length > 0 && importGenRef.current === gen) {
        const first = completedEpisodes[0];
        episodeState.setSelectedEpisodeId(first.id);
        episodeState.setOpenedEpisodeId(first.id);
        appState.setImportedVideoPath(first.videoPath);
        setImportToken(Date.now().toString());
        startTransition(() => {
          appState.setClips(first.clips);
        });
      }
    } finally {
      if (importGenRef.current === gen) {
        setLoading(false);
        setBatchTotal(0);
        setBatchDone(0);
        setBatchCurrentFile(null);
      }
    }
  }, [appState, episodeState, generalSettings, abortedRef]);

  const onImportClick = useCallback(async () => {
    const files = await open({
      multiple: true,
      filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "avi"] }],
    });

    if (!files) return;
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return;

    if (fileList.length === 1) {
      handleImport(fileList[0]);
    } else {
      handleBatchImport(fileList);
    }
  }, [handleImport, handleBatchImport]);

  const handleExport = useCallback(async (selectedClips: Set<string>, mergeEnabled: boolean, mergeFileName?: string) => {
    if (selectedClips.size === 0) return;

    const selected = appState.clips.filter((c: ClipItem) => selectedClips.has(c.id));
    if (selected.length === 0) return;

    let dir = persistedState.exportDir;
    if (!dir) {
      const picked = await open({ directory: true, multiple: false });
      if (!picked) return;
      dir = picked as string;
      persistedState.setExportDir(dir);
    }

    try {
      setLoading(true);

      const sep = dir.includes('\\') ? '\\' : '/';
      const clipArray = selected.flatMap((c: ClipItem) => c.mergedSrcs ?? [c.src]);
      const format = generalSettings.exportFormat || "mp4";

      props?.onRPCUpdate?.({
        type: "update",
        details: `Exporting ${selected.length} clips`,
        state: "Saving Progress",
        large_image: "amverge_logo",
        small_image: generalSettings.rpcShowMiniIcons ? "save_icon_new" : undefined,
        small_text: generalSettings.rpcShowMiniIcons ? "Exporting..." : undefined,
        buttons: generalSettings.rpcShowButtons,
      });

      if (mergeEnabled) {
        const baseName = mergeFileName || ((selected[0]?.originalName || "episode") + "_merged");
        const savePath = `${dir}${sep}${baseName}.${format}`;
        await invoke("export_clips", { clips: clipArray, savePath, mergeEnabled });
      } else {
        const firstClipPath = selected[0]?.src || "";
        const firstFile = firstClipPath.split(/[/\\]/).pop() || `episode_0000.${format}`;
        const firstStem = firstFile.replace(/\.[^/.]+$/, "");
        const defaultBase = firstStem.replace(/_\d{4}$/, "");
        const savePath = `${dir}${sep}${defaultBase}_####.${format}`;
        await invoke("export_clips", { clips: clipArray, savePath, mergeEnabled: false });
      }

      props?.onRPCUpdate?.({
        type: "update",
        details: "Export Finished!",
        state: "Success",
        large_image: "amverge_logo",
        small_image: generalSettings.rpcShowMiniIcons ? "check_icon_new" : undefined,
        small_text: generalSettings.rpcShowMiniIcons ? "Done" : undefined,
        buttons: generalSettings.rpcShowButtons,
      });

      setTimeout(() => {
        props?.onRPCUpdate?.({
          type: "update",
          details: "Editing Episode",
          state: "Ready",
          large_image: "amverge_logo",
          small_image: generalSettings.rpcShowMiniIcons ? "edit_icon_new" : undefined,
          small_text: generalSettings.rpcShowMiniIcons ? "Editing" : undefined,
          buttons: generalSettings.rpcShowButtons,
        });
      }, 10000);
    } catch (err) {
      console.log("Export failed:", err);
    } finally {
      setLoading(false);
    }
  }, [appState.clips, persistedState, generalSettings, props?.onRPCUpdate]);

  const handlePickExportDir = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) persistedState.setExportDir(dir as string);
  }, [persistedState]);

  const handleDownloadSingleClip = useCallback(async (clip: ClipItem) => {
    try {
      const format = generalSettings.exportFormat || "mp4";
      const fileName = clip.originalName || fileNameFromPath(clip.src);
      const defaultPath = `${fileName}.${format}`;

      const savePath = await save({
        defaultPath,
        filters: [{ name: "Video", extensions: [format] }],
      });

      if (!savePath) return;

      setLoading(true);
      const srcs = clip.mergedSrcs ?? [clip.src];
      await invoke("export_clips", { clips: srcs, savePath, mergeEnabled: srcs.length > 1 });
    } catch (err) {
      console.error("Single clip download failed:", err);
    } finally {
      setLoading(false);
    }
  }, [generalSettings.exportFormat]);

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
    handleDownloadSingleClip,
  };
}
