import { useRef, startTransition, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ClipItem, EpisodeEntry } from "../types/domain"
import { fileNameFromPath, truncateFileName, detectScenes } from "../utils/episodeUtils";
import {
  buildTimelineXmlClips,
  buildXmlSavePath,
  resolveTimelineName,
} from "../features/export/xmlTimeline";
import { editorLabel, type EditorTarget } from "../features/export/targets";

import { useAppStateStore, useAppPersistedStore } from "../stores/appStore";
import { useEpisodePanelRuntimeStore } from "../stores/episodeStore";
import { useGeneralSettingsStore } from "../stores/settingsStore";
import {
  getActiveExportProfile,
  isQuickDownloadCompatibleWorkflow,
  supportsClipMerge,
  type ExportProfile,
} from "../features/export/profiles";

type ImportExportProps = {
  abortedRef?: React.RefObject<boolean>;
  onRPCUpdate?: (data: any) => void;
};

function toExportOptions(profile: ExportProfile) {
  return {
    profileId: profile.id,
    workflow: profile.workflow,
    editorTarget: profile.editorTarget,
    codec: profile.codec,
    audioMode: profile.audioMode,
    hardwareMode: profile.hardwareMode,
    parallelExports: profile.parallelExports,
  };
}

function resolveQuickDownloadProfile(settings: {
  exportProfiles: ExportProfile[];
  activeExportProfileId: string;
  quickDownloadProfileId: string;
}): ExportProfile {
  const quickProfile = settings.exportProfiles.find(
    (profile) => profile.id === settings.quickDownloadProfileId
  );
  if (quickProfile && isQuickDownloadCompatibleWorkflow(quickProfile.workflow)) {
    return quickProfile;
  }

  const activeProfile = getActiveExportProfile(
    settings.exportProfiles,
    settings.activeExportProfileId
  );
  if (isQuickDownloadCompatibleWorkflow(activeProfile.workflow)) {
    return activeProfile;
  }

  const firstCompatible = settings.exportProfiles.find((profile) =>
    isQuickDownloadCompatibleWorkflow(profile.workflow)
  );
  return firstCompatible || activeProfile;
}

function resolveEditorTarget(editorTarget: ExportProfile["editorTarget"]): EditorTarget | null {
  if (editorTarget === "premiere_pro") return "premier_pro";
  if (editorTarget === "after_effects") return "after_effects";
  if (editorTarget === "davinci_resolve") return "davinci_resolve";
  if (editorTarget === "capcut") return "capcut";
  return null;
}

function uniquePathList(paths: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const rawPath of paths) {
    const path = (rawPath || "").trim();
    if (!path) continue;
    const key = path.replace(/\//g, "\\").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(path);
  }

  return unique;
}

function resolveAutoImportMediaPaths(
  editorTarget: EditorTarget,
  selected: ClipItem[],
  exportedPaths: string[],
): string[] {
  if (editorTarget !== "capcut") {
    return exportedPaths;
  }

  const originalSourcePaths = uniquePathList(selected.map((clip) => clip.originalPath));
  return originalSourcePaths.length > 0 ? originalSourcePaths : exportedPaths;
}

function formatAutoImportFailureMessage(target: EditorTarget, rawError: unknown): string {
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
}

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
    // This opens the file dialog to select a video file
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

      // A newer import started while we were waiting - discard stale results.
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

  const onImportClick = useCallback(async () => {
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
  }, [handleImport]);

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
            // Aborted or superseded mid-flight — clean up this episode's cache
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

      // Open the first completed episode
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

  const handleExport = useCallback(async (selectedClips: Set<string>, mergeEnabled?: boolean, mergeFileName?: string) => {
    if (selectedClips.size === 0) return;

    const selected = appState.clips.filter((c: ClipItem) => selectedClips.has(c.id));
    if (selected.length === 0) return;
    const exportProfile = getActiveExportProfile(
      generalSettings.exportProfiles,
      generalSettings.activeExportProfileId
    );
    const resolvedMergeEnabled =
      supportsClipMerge(exportProfile.workflow) && (mergeEnabled ?? exportProfile.mergeEnabled);
    const editorTarget = resolveEditorTarget(exportProfile.editorTarget);
    const workflow = exportProfile.workflow;

    // If no export directory is set, prompt the user to pick one first
    let dir = persistedState.exportDir;
    if (!dir) {
      const picked = await open({ directory: true, multiple: false });
      if (!picked) return;
      dir = picked as string;
      persistedState.setExportDir(dir);
    }

    try {
      setLoading(true);
      appState.setProgress(0);
      appState.setProgressMsg("Preparing export...");

      const sep = dir.includes('\\') ? '\\' : '/';
      const clipArray = selected.map((c: ClipItem) => c.src);
      const format = exportProfile.container || generalSettings.exportFormat || "mp4";
      const exportOptions = toExportOptions(exportProfile);
      const shouldAutoImportMedia = workflow === "editor_encode" || workflow === "editor_remux";

      props?.onRPCUpdate?.({
        type: "update",
        details: `Exporting ${selected.length} clips (${exportProfile.name || "Export Profile"})`,
        state: "Saving Progress",
        large_image: "amverge_logo",
        small_image: generalSettings.rpcShowMiniIcons ? "save_icon_new" : undefined,
        small_text: generalSettings.rpcShowMiniIcons ? "Exporting..." : undefined,
        buttons: generalSettings.rpcShowButtons,
      });

      if (workflow === "editor_original_xml") {
        if (!editorTarget) {
          throw new Error("No editor target selected for XML export.");
        }
        if (editorTarget === "capcut") {
          throw new Error("Original-cut timeline export is not supported for CapCut.");
        }

        const sequenceName = resolveTimelineName(
          selected,
          resolvedMergeEnabled ? mergeFileName : undefined
        );
        const timelineClips = buildTimelineXmlClips(selected, appState.importedVideoPath);
        const savePath = buildXmlSavePath(dir, sequenceName);

        appState.setProgress(96);
        appState.setProgressMsg(`Generating XML timeline for ${editorLabel(editorTarget)}...`);

        await invoke<void>("export_timeline_xml", {
          clips: timelineClips,
          savePath,
          sequenceName,
        });

        appState.setProgress(99);
        appState.setProgressMsg(`Importing timeline into ${editorLabel(editorTarget)}...`);

        await invoke<string>("import_original_cut_to_editor", {
          editorTarget,
          clips: timelineClips,
          sequenceName,
        });
      } else if (resolvedMergeEnabled) {
        const baseName = mergeFileName || ((selected[0]?.originalName || "episode") + "_merged");
        const savePath = `${dir}${sep}${baseName}.${format}`;

        const exportedPaths = await invoke<string[]>("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: resolvedMergeEnabled,
          exportOptions,
        });
        if (shouldAutoImportMedia && editorTarget && exportedPaths.length > 0) {
          appState.setProgress(99);
          appState.setProgressMsg(`Importing media into ${editorLabel(editorTarget)}...`);
          const mediaPathsForImport = resolveAutoImportMediaPaths(editorTarget, selected, exportedPaths);
          await invoke<string>("import_media_to_editor", {
            editorTarget,
            mediaPaths: mediaPathsForImport,
          });
        }
      } else {
        const firstClipPath = selected[0]?.src || "";
        const firstFile = firstClipPath.split(/[/\\]/).pop() || `episode_0000.${format}`;
        const firstStem = firstFile.replace(/\.[^/.]+$/, "");
        const defaultBase = firstStem.replace(/_\d{4}$/, "");
        const savePath = `${dir}${sep}${defaultBase}_####.${format}`;

        const exportedPaths = await invoke<string[]>("export_clips", {
          clips: clipArray,
          savePath: savePath,
          mergeEnabled: false,
          exportOptions,
        });
        if (shouldAutoImportMedia && editorTarget && exportedPaths.length > 0) {
          appState.setProgress(99);
          appState.setProgressMsg(`Importing media into ${editorLabel(editorTarget)}...`);
          const mediaPathsForImport = resolveAutoImportMediaPaths(editorTarget, selected, exportedPaths);
          await invoke<string>("import_media_to_editor", {
            editorTarget,
            mediaPaths: mediaPathsForImport,
          });
        }
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

      // Revert back to normal state after 10 seconds
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
      if (editorTarget) {
        const msg = formatAutoImportFailureMessage(editorTarget, err);
        appState.setProgress(100);
        appState.setProgressMsg(msg);
      }
      console.log("Export failed:", err)
    } finally {
      setLoading(false);
    }
  }, [appState, persistedState, generalSettings, props?.onRPCUpdate]);

  const handlePickExportDir = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) persistedState.setExportDir(dir as string);
  }, [persistedState]);

  const handleDownloadSingleClip = useCallback(async (clip: ClipItem) => {
    try {
      const settings = useGeneralSettingsStore.getState();
      const exportProfile = resolveQuickDownloadProfile(settings);
      const workflow = exportProfile.workflow;
      const editorTarget = resolveEditorTarget(exportProfile.editorTarget);
      const shouldAutoImportMedia = workflow === "editor_encode" || workflow === "editor_remux";
      const format = exportProfile.container || settings.exportFormat || "mp4";
      const fileName = clip.originalName || fileNameFromPath(clip.src);
      const defaultPath = `${fileName}.${format}`;

      const savePath = await save({
        defaultPath,
        filters: [{ name: "Video", extensions: [format] }],
      });

      if (!savePath) return;

      setLoading(true);
      const exportedPaths = await invoke<string[]>("export_clips", {
        clips: [clip.src],
        savePath: savePath,
        mergeEnabled: false,
        exportOptions: toExportOptions(exportProfile),
      });

      if (shouldAutoImportMedia && editorTarget && exportedPaths.length > 0) {
        const mediaPathsForImport = resolveAutoImportMediaPaths(editorTarget, [clip], exportedPaths);
        await invoke<string>("import_media_to_editor", {
          editorTarget,
          mediaPaths: mediaPathsForImport,
        });
      }
      console.log("Single clip download complete");
    } catch (err) {
      console.error("Single clip download failed:", err);
    } finally {
      setLoading(false);
    }
  }, [setLoading]);

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
