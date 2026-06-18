import { useRef, startTransition, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ClipItem, EpisodeEntry } from "../types/domain"
import { fileNameFromPath, truncateFileName, loadEpisodeManifest } from "../utils/episodeUtils";
import {
  getRecommendedContainerForCodec,
  isExportCodecContainerCompatible,
} from "../features/export/profiles";

import { useAppStateStore, useAppPersistedStore } from "../stores/appStore";
import { useEpisodePanelRuntimeStore } from "../stores/episodeStore";
import { useGeneralSettingsStore } from "../stores/settingsStore";

type ImportExportProps = {
  abortedRef?: React.RefObject<boolean>;
  onRPCUpdate?: (data: any) => void;
};
type ExportOptionsPayload = {
  profileId: string;
  workflow: string;
  editorTarget: string;
  codec: string;
  audioMode: string;
  hardwareMode: string;
  parallelExports: number;
};

export default function useImportExport(props?: ImportExportProps) {
  const appState = useAppStateStore();
  const episodeState = useEpisodePanelRuntimeStore();
  const generalSettings = useGeneralSettingsStore();
  const persistedState = useAppPersistedStore();

  const loading = appState.loading;
  const setLoading = appState.setLoading;
  const setBgImportProgress = appState.setBgImportProgress;
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

  const logImportError = useCallback((phase: string, error: unknown, context?: Record<string, unknown>) => {
    const details = {
      phase,
      context: context ?? {},
      message: error instanceof Error ? error.message : String(error),
      error,
    };
    console.error("[import] failure", details);
  }, []);
  const buildExportOptionsPayload = useCallback((profileId: string): ExportOptionsPayload | undefined => {
    const profile = generalSettings.exportProfiles.find((candidate) => candidate.id === profileId)
      ?? generalSettings.exportProfiles[0];
    if (!profile) return undefined;

    // Pass audioMode through as-is. The Rust backend now handles "copy" fallback
    // safely (probes source audio codec and switches to AAC/etc. when copy would
    // fail the muxer) and recognizes "none" as `-an`. Silently rewriting here
    // was hiding muxer-incompat failures and producing 0 KB outputs.
    let audioMode = profile.audioMode;
    if (profile.container === "mov" && audioMode === "flac") {
      // MOV + FLAC isn't natively supported; ALAC keeps lossless audio in a MOV-friendly format.
      audioMode = "alac";
    }

    return {
      profileId: profile.id,
      workflow: profile.workflow,
      editorTarget: profile.editorTarget,
      codec: profile.codec,
      audioMode,
      hardwareMode: profile.hardwareMode,
      parallelExports: profile.parallelExports,
    };
  }, [generalSettings.exportProfiles]);

  function parseManifestInitialClips(manifest: any, episodeId: string): ClipItem[] {
    const raw = Array.isArray(manifest?.initialClips) ? manifest.initialClips : [];

    const clipsFromInitial = raw.map((s: any, index: number) => ({
      id: `${episodeId}_${typeof s?.scene_index === "number" ? s.scene_index : index}`,
      src: s.path,
      thumbnail: s.thumbnail,
      originalName: s.original_file,
      originalPath: s.original_path,
      sceneIndex: typeof s.scene_index === "number" ? s.scene_index : undefined,
      startSec: typeof s.start === "number" ? s.start : undefined,
      endSec: typeof s.end === "number" ? s.end : undefined,
      start: s.start,
      end: s.end,
    }));

    if (clipsFromInitial.length > 0) {
      return clipsFromInitial;
    }

    const sourceVideoPath = typeof manifest?.source?.videoPath === "string" ? manifest.source.videoPath : null;
    const sourceVideoName = sourceVideoPath ? fileNameFromPath(sourceVideoPath) : undefined;
    const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];

    return scenes.map((scene: any, index: number) => {
      const startSec = typeof scene?.start_sec === "number" ? scene.start_sec : undefined;
      const endSec = typeof scene?.end_sec === "number" ? scene.end_sec : undefined;
      const sceneIndex = typeof scene?.scene_index === "number" ? scene.scene_index : index;

      return {
        id: `${episodeId}_${sceneIndex}`,
        src: sourceVideoPath || "",
        thumbnail: sourceVideoPath || "",
        originalName: sourceVideoName,
        originalPath: sourceVideoPath || undefined,
        sceneIndex,
        startSec,
        endSec,
        start: startSec,
        end: endSec,
      };
    });
  }

  function buildEpisodeCacheId(file: string): string {
    const fileName = fileNameFromPath(file);
    const stem = fileName.replace(/\.[^./\\]+$/, "");
    const sanitizedStem = stem
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
    const safeStem = sanitizedStem.length > 0 ? sanitizedStem : "episode";
    const shortSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

    return `${safeStem}_${shortSuffix}`;
  }

  const importEpisodeFromManifest = useCallback(async (file: string, episodeId: string): Promise<{
    episodeEntry: EpisodeEntry;
    sceneCount: number;
  }> => {
    await invoke("detect_scenes", {
      videoPath: file,
      episodeCacheId: episodeId,
      customPath: generalSettings.episodesPath,
      sceneDetectionMethod: generalSettings.sceneDetectionMethod,
    });

    const manifest = await loadEpisodeManifest(episodeId, generalSettings.episodesPath);
    const clips = parseManifestInitialClips(manifest, episodeId);
    if (clips.length === 0) {
      throw new Error("Manifest import path produced no clips.");
    }

    const inferredName = clips[0]?.originalName || fileNameFromPath(file);
    const episodeEntry: EpisodeEntry = {
      id: episodeId,
      displayName: inferredName,
      videoPath: file,
      folderId: episodeState.selectedFolderId,
      importedAt: Date.now(),
      clips,
    };

    const sceneCount = Array.isArray(manifest?.scenes) ? manifest.scenes.length : clips.length;
    return { episodeEntry, sceneCount };
  }, [generalSettings.episodesPath, generalSettings.sceneDetectionMethod, episodeState.selectedFolderId]);

  const handleImport = useCallback(async (file: string | null) => {
    if (!file) return;
    const currentState = useAppStateStore.getState();
    if (currentState.loading || currentState.bgProgress || currentState.bgImportProgress) return;

    console.info("[import] start", { mode: "single", file, episodePath: generalSettings.episodesPath });

    const episodeId = buildEpisodeCacheId(file);
    const gen = ++importGenRef.current;

    try {
      appState.setProgress(0);
      appState.setProgressMsg("Starting...");
      setLoading(true);
      appState.setSelectedClips(new Set());
      appState.setFocusedClip(null);
      appState.setFocusedClipId(null);
      appState.setImportedVideoPath(file);
      appState.setVideoIsHEVC(null);
      setImportToken(Date.now().toString());
      props?.onRPCUpdate?.({
        type: "update",
        details: `Detecting: ${generalSettings.rpcShowFilename ? fileNameFromPath(file) : "Video"}`,
        state: "Processing Video",
        large_image: "amverge_logo",
        small_image: generalSettings.rpcShowMiniIcons ? "loading_icon_new" : undefined,
        small_text: generalSettings.rpcShowMiniIcons ? "Detecting..." : undefined,
        buttons: generalSettings.rpcShowButtons,
      });

      const { episodeEntry, sceneCount } = await importEpisodeFromManifest(file, episodeId);

      episodeState.setEpisodes((prev) => [episodeEntry, ...prev]);
      episodeState.setSelectedEpisodeId(episodeId);
      episodeState.setOpenedEpisodeId(episodeId);
      useAppStateStore.setState({ clips: episodeEntry.clips });

      console.info("[import] manifest hydration path", {
        mode: "single",
        episodeId,
        clips: episodeEntry.clips.length,
        scenes: sceneCount,
      });
      console.info("[import] detect_scenes completed", { mode: "single", file, episodeId });
    } catch (err) {
      if (importGenRef.current !== gen) return;
      logImportError("single.detect_scenes", err, {
        file,
        episodeId,
        episodePath: generalSettings.episodesPath,
        importGeneration: gen,
      });
      useAppStateStore.setState({ bgProgress: null });
    } finally {
      if (importGenRef.current === gen) setLoading(false);
      console.info("[import] finished", { mode: "single", file, episodeId, importGeneration: gen });
    }
  }, [appState, episodeState, generalSettings, props?.onRPCUpdate, logImportError, importEpisodeFromManifest]);

  const handleBatchImport = useCallback(async (files: string[]) => {
    if (files.length === 0) return;
    const currentState = useAppStateStore.getState();
    if (currentState.loading || currentState.bgProgress || currentState.bgImportProgress) return;

    const gen = ++importGenRef.current;
    abortedRef.current = false;
    const completedEpisodes: EpisodeEntry[] = [];
    console.info("[import] start", {
      mode: "batch",
      files: files.length,
      episodePath: generalSettings.episodesPath,
    });
    try {
      appState.setProgress(0);
      appState.setProgressMsg("Starting...");
      setLoading(false);
      appState.setSelectedClips(new Set());
      appState.setFocusedClip(null);
      appState.setFocusedClipId(null);
      appState.setVideoIsHEVC(null);
      useAppStateStore.setState({ bgProgress: null });
      setBgImportProgress({ done: 0, total: files.length });
      setImportToken(Date.now().toString());
      setBatchTotal(files.length);
      setBatchDone(0);
      setBatchCurrentFile("");

      for (let i = 0; i < files.length; i++) {
        if (abortedRef.current) break;
        if (importGenRef.current !== gen) return;
        const file = files[i];
        const episodeId = buildEpisodeCacheId(file);
        const fileName = fileNameFromPath(file);
        setBatchDone(i);
        setBatchCurrentFile(truncateFileName(fileName));
        appState.setProgress(0);
        appState.setProgressMsg("Starting...");
        useAppStateStore.setState({ bgProgress: null });
        console.info("[import] batch file begin", {
          index: i + 1,
          total: files.length,
          file,
          episodeId,
        });

        try {
          const { episodeEntry, sceneCount: manifestSceneCount } = await importEpisodeFromManifest(file, episodeId);
          console.info("[import] manifest verified", {
            mode: "batch",
            episodeId,
            scenes: manifestSceneCount,
          });
          if (abortedRef.current || importGenRef.current !== gen) {
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: generalSettings.episodesPath,
            }).catch(() => { });
            break;
          }

          completedEpisodes.push(episodeEntry);
          episodeState.setEpisodes((prev) => [episodeEntry, ...prev]);
          setBgImportProgress({ done: i + 1, total: files.length });
          console.info("[import] batch file success", {
            index: i + 1,
            total: files.length,
            file,
            episodeId,
            clips: episodeEntry.clips.length,
          });
        } catch (err) {
          if (abortedRef.current) {
            invoke("delete_episode_cache", {
              episodeCacheId: episodeId,
              customPath: generalSettings.episodesPath,
            }).catch(() => { });
            break;
          }
          logImportError("batch.detect_scenes", err, {
            index: i + 1,
            total: files.length,
            file,
            fileName,
            episodeId,
            episodePath: generalSettings.episodesPath,
          });
          invoke("delete_episode_cache", {
            episodeCacheId: episodeId,
            customPath: generalSettings.episodesPath,
          }).catch(() => { });
          setBgImportProgress({ done: i + 1, total: files.length });
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
        setBgImportProgress(null);
        useAppStateStore.setState({ bgProgress: null });
        setBatchTotal(0);
        setBatchDone(0);
        setBatchCurrentFile(null);
      }
      console.info("[import] finished", {
        mode: "batch",
        requested: files.length,
        completed: completedEpisodes.length,
        importGeneration: gen,
      });
    }
  }, [appState, episodeState, generalSettings, abortedRef, setBgImportProgress, logImportError, importEpisodeFromManifest]);

  const onImportClick = useCallback(async () => {
    const currentState = useAppStateStore.getState();
    if (currentState.loading || currentState.bgProgress || currentState.bgImportProgress) return;

    try {
      const files = await open({
        multiple: true,
        filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "avi"] }],
      });
      if (!files) {
        console.info("[import] picker canceled");
        return;
      }

      const fileList = Array.isArray(files) ? files : [files];
      if (fileList.length === 0) {
        console.warn("[import] picker returned no files");
        return;
      }

      if (fileList.length === 1) {
        await handleImport(fileList[0]);
      } else {
        await handleBatchImport(fileList);
      }
    } catch (err) {
      logImportError("picker.open", err);
    }
  }, [handleImport, handleBatchImport, logImportError]);

  const handleExport = useCallback(async (selectedClips: Set<string>, mergeEnabled: boolean, mergeFileName?: string) => {
    console.log(`[handleExport] selectedClips.size=${selectedClips.size} appState.clips.length=${appState.clips.length} IDs=[${[...selectedClips].slice(0, 3).join(',')}]`);
    if (selectedClips.size === 0) return;
    const selected = appState.clips.filter((c: ClipItem) => selectedClips.has(c.id));
    console.log(`[handleExport] matched ${selected.length} clips from store`);
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
      const exportOptions = buildExportOptionsPayload(generalSettings.activeExportProfileId);
      const activeProfile = generalSettings.exportProfiles.find(
        (candidate) => candidate.id === generalSettings.activeExportProfileId
      ) ?? generalSettings.exportProfiles[0];
      const preferredFormat = activeProfile?.container || "mp4";
      const format =
        activeProfile &&
        activeProfile.workflow === "video_encode" &&
        !isExportCodecContainerCompatible(activeProfile.codec, preferredFormat)
          ? getRecommendedContainerForCodec(activeProfile.codec)
          : preferredFormat;

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
        const rawBase = mergeFileName || ((selected[0]?.originalName || "episode") + "_merged");
        // Sanitize: strip path separators, control chars, and reserved characters;
        // collapse to a safe filename. Prevents traversal injection (e.g. "../foo").
        const baseName = (rawBase
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
          .replace(/^\.+/, "_")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180)) || "merged";
        const savePath = `${dir}${sep}${baseName}.${format}`;
        const exportedFiles = await invoke<string[]>("export_clips", {
          clips: clipArray,
          savePath,
          mergeEnabled,
          exportOptions,
        });
        if (generalSettings.openFileLocationAfterExport && exportedFiles.length > 0) {
          await invoke("reveal_in_file_manager", { filePath: exportedFiles[0] });
        }

      } else {
        const firstClipPath = selected[0]?.src || "";
        const firstFile = firstClipPath.split(/[/\\]/).pop() || `episode_0000.${format}`;
        const firstStem = firstFile.replace(/\.[^/.]+$/, "");
        const defaultBase = firstStem.replace(/_\d{4}$/, "");
        const savePath = `${dir}${sep}${defaultBase}_####.${format}`;
        const exportedFiles = await invoke<string[]>("export_clips", {
          clips: clipArray,
          savePath,
          mergeEnabled: false,
          exportOptions,
        });
        if (generalSettings.openFileLocationAfterExport && exportedFiles.length > 0) {
          await invoke("reveal_in_file_manager", { filePath: exportedFiles[0] });
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
      const message = typeof err === "string"
        ? err
        : (err instanceof Error ? err.message : "Unknown error");
      console.error("Export failed:", err);
      appState.setProgressMsg(`Export failed: ${message}`);
      props?.onRPCUpdate?.({
        type: "update",
        details: "Export Failed",
        state: message.slice(0, 120),
        large_image: "amverge_logo",
        small_image: generalSettings.rpcShowMiniIcons ? "edit_icon_new" : undefined,
        small_text: generalSettings.rpcShowMiniIcons ? "Error" : undefined,
        buttons: generalSettings.rpcShowButtons,
      });
      setTimeout(() => {
        appState.setProgressMsg("");
      }, 8000);
    } finally {
      setLoading(false);
    }
  }, [appState, buildExportOptionsPayload, persistedState, generalSettings, props?.onRPCUpdate]);

  const handlePickExportDir = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) persistedState.setExportDir(dir as string);
  }, [persistedState]);

  const handleDownloadSingleClip = useCallback(async (clip: ClipItem) => {
    try {
      const activeProfile = generalSettings.exportProfiles.find(
        (candidate) => candidate.id === generalSettings.activeExportProfileId
      ) ?? generalSettings.exportProfiles[0];
      const preferredFormat = activeProfile?.container || "mp4";
      const format =
        activeProfile &&
        activeProfile.workflow === "video_encode" &&
        !isExportCodecContainerCompatible(activeProfile.codec, preferredFormat)
          ? getRecommendedContainerForCodec(activeProfile.codec)
          : preferredFormat;
      const fileName = clip.originalName || fileNameFromPath(clip.src);
      const defaultPath = `${fileName}.${format}`;
      const savePath = await save({
        defaultPath,
        filters: [{ name: "Video", extensions: [format] }],
      });

      if (!savePath) return;

      setLoading(true);

      const srcs = clip.mergedSrcs ?? [clip.src];
      const exportOptions = buildExportOptionsPayload(generalSettings.activeExportProfileId);
      const exportedFiles = await invoke<string[]>("export_clips", {
        clips: srcs,
        savePath,
        mergeEnabled: srcs.length > 1,
        exportOptions,
      });
      if (generalSettings.openFileLocationAfterExport && exportedFiles.length > 0) {
        await invoke("reveal_in_file_manager", { filePath: exportedFiles[0] });
      }
    } catch (err) {
      const message = typeof err === "string"
        ? err
        : (err instanceof Error ? err.message : "Unknown error");
      console.error("Single clip download failed:", err);
      appState.setProgressMsg(`Export failed: ${message}`);
      setTimeout(() => {
        appState.setProgressMsg("");
      }, 8000);
    } finally {
      setLoading(false);
    }

  }, [appState, buildExportOptionsPayload, generalSettings.exportFormat, generalSettings.exportProfiles, generalSettings.openFileLocationAfterExport, generalSettings.activeExportProfileId]);

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

