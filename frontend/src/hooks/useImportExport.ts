import { useRef, startTransition, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  // Teardown for the currently active video-streaming listener set. A new import
  // stops the previous one first so background phase-2 events from an earlier
  // import can't cross-patch the new episode's grid.
  const streamCleanupRef = useRef<(() => void) | null>(null);

  // Import timeline by mode:
  // 1) video_files: wire streaming listeners -> run detect_scenes -> stream clip updates
  //    -> load final manifest -> hydrate final episode state.
  // 2) webp_files: run detect_scenes -> load final manifest -> hydrate final episode state.
  //    (WebP previews are generated later by the preview queue, not during detect_scenes.)

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
      thumbnailReady: s.thumbnail_ready !== false,
      originalName: s.original_file,
      originalPath: s.original_path,
      sceneIndex: typeof s.scene_index === "number" ? s.scene_index : undefined,
      startSec: typeof s.start_sec === "number" ? s.start_sec : undefined,
      endSec: typeof s.end_sec === "number" ? s.end_sec : undefined,
      clipPath: typeof s.clip_path === "string" ? s.clip_path : undefined,
      clipMode: typeof s.clip_mode === "string" && s.clip_mode ? s.clip_mode : undefined,
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

  const startVideoStreamingListeners = useCallback(async (
    file: string,
    episodeId: string,
  ): Promise<{ stop: () => void; phase1Done: Promise<void> }> => {
    let unlistenInitial: (() => void) | null = null;
    let unlistenClip: (() => void) | null = null;
    let unlistenThumb: (() => void) | null = null;
    let unlistenPhase1: (() => void) | null = null;
    let unlistenReencode: (() => void) | null = null;

    let resolvePhase1: () => void = () => {};
    const phase1Done = new Promise<void>((resolve) => {
      resolvePhase1 = resolve;
    });

    unlistenInitial = await listen<{ clips_json: string }>("initial_clips_ready", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.payload.clips_json);
      } catch {
        return;
      }
      const clips = parseManifestInitialClips({ initialClips: parsed }, episodeId);
      if (clips.length === 0) return;

      const inferredName = clips[0]?.originalName || fileNameFromPath(file);
      const entry: EpisodeEntry = {
        id: episodeId,
        displayName: inferredName,
        videoPath: file,
        folderId: episodeState.selectedFolderId,
        importedAt: Date.now(),
        clips,
        importMethod: generalSettings.importMethod,
      };
      episodeState.setEpisodes((prev) => [entry, ...prev.filter((ep) => ep.id !== episodeId)]);
      episodeState.setSelectedEpisodeId(episodeId);
      episodeState.setOpenedEpisodeId(episodeId);
      // Keep `loading` true: the full-screen skeleton stays up until phase-1
      // (keyframe) clips are cut, so the grid appears already populated rather
      // than flashing per-tile skeletons. clip_ready patches fill these clips in
      // while still hidden under the loading screen.
      useAppStateStore.setState({ clips });
    });

    // Coalesce clip_ready patches. Keyframe copies finish in bursts — applying
    // each as its own setState re-renders the whole grid every time (two O(n)
    // store maps per event), which freezes the UI during import. Instead we
    // buffer patches by clip id and flush them all in a single update per frame.
    const pendingPatches = new Map<string, Partial<ClipItem>>();
    // Merge (not replace) so a clip_ready and a thumbnail_ready for the same clip
    // within one frame don't clobber each other.
    const mergePatch = (id: string, patch: Partial<ClipItem>) => {
      pendingPatches.set(id, { ...(pendingPatches.get(id) ?? {}), ...patch });
    };
    let flushHandle: number | null = null;

    const flushPatches = () => {
      flushHandle = null;
      if (pendingPatches.size === 0) return;
      const snapshot = new Map(pendingPatches);
      pendingPatches.clear();
      const applyPatch = (c: ClipItem): ClipItem => {
        const p = snapshot.get(c.id);
        return p ? { ...c, ...p } : c;
      };
      useAppStateStore.setState((s) => ({ clips: s.clips.map(applyPatch) }));
      episodeState.setEpisodes((prev) =>
        prev.map((ep) => (ep.id === episodeId ? { ...ep, clips: ep.clips.map(applyPatch) } : ep))
      );
    };

    const scheduleFlush = () => {
      if (flushHandle === null) flushHandle = requestAnimationFrame(flushPatches);
    };

    const cancelFlush = () => {
      if (flushHandle !== null) {
        cancelAnimationFrame(flushHandle);
        flushHandle = null;
      }
    };

    unlistenClip = await listen<{ scene_index: number; clip_path: string | null; clip_mode: string }>(
      "clip_ready",
      (event) => {
        const { scene_index, clip_path, clip_mode } = event.payload;
        mergePatch(`${episodeId}_${scene_index}`, {
          clipPath: clip_path ?? undefined,
          clipMode: clip_mode || undefined,
        });
        scheduleFlush();
      }
    );

    // Static jpg poster finished for a scene → flip its thumbnailReady so the
    // grid swaps the skeleton for the still image (mirrors production).
    unlistenThumb = await listen<{ position: number }>("thumbnail_ready", (event) => {
      const { position } = event.payload;
      mergePatch(`${episodeId}_${position}`, { thumbnailReady: true });
      scheduleFlush();
    });

    // Phase 1 (keyframe copies) done: drop the loading screen now. Phase-2
    // re-encodes keep streaming via clip_ready and fill their tiles in the
    // background while the user already sees the keyframe grid.
    unlistenPhase1 = await listen("phase1_complete", () => {
      // Flush synchronously so every keyframe clip path is in the store before
      // the import resolves and the grid is revealed.
      cancelFlush();
      flushPatches();
      useAppStateStore.setState({ loading: false });
      resolvePhase1();
    });

    // Background phase-2 re-encode progress → drives the "Reencoding X/Y" count
    // in the draggable background progress bar. Cleared once it reaches total.
    unlistenReencode = await listen<{ done: number; total: number }>("reencode_progress", (event) => {
      const { done, total } = event.payload;
      useAppStateStore.setState({
        reencodeProgress: total > 0 && done < total ? { done, total } : null,
      });
    });

    const stop = () => {
      // Apply any patches buffered right before teardown so none are dropped.
      cancelFlush();
      flushPatches();
      if (unlistenInitial) unlistenInitial();
      if (unlistenClip) unlistenClip();
      if (unlistenThumb) unlistenThumb();
      if (unlistenPhase1) unlistenPhase1();
      if (unlistenReencode) unlistenReencode();
      // Clear any lingering re-encode indicator for this session.
      useAppStateStore.setState({ reencodeProgress: null });
    };

    return { stop, phase1Done };
  }, [episodeState, generalSettings.importMethod]);

  const runImportPipeline = useCallback(async (
    file: string,
    episodeId: string,
    streamToGrid = false,
  ): Promise<{
    episodeEntry: EpisodeEntry;
    sceneCount: number;
  }> => {
    // In video-preview mode we stream clips into the grid as the backend cuts
    // them: keep the loading screen up through phase-1 (keyframe copies), then
    // resolve the import as soon as those are done. Phase-2 re-encodes keep
    // streaming via clip_ready and fill their tiles in the background.
    const videoStreaming = streamToGrid && generalSettings.importMethod === "video_files";

    if (videoStreaming) {
      // Stop any previous streaming session so a still-running background
      // phase-2 from an earlier import can't cross-patch this episode.
      streamCleanupRef.current?.();
      const { stop, phase1Done } = await startVideoStreamingListeners(file, episodeId);
      streamCleanupRef.current = stop;

      // Fire detection but DON'T block import completion on it — the process
      // keeps running phase-2 after phase1_complete. Listeners are torn down
      // only when the whole process ends (success or failure).
      let invokeError: unknown = null;
      const invokeSettled = invoke("detect_scenes", {
        videoPath: file,
        episodeCacheId: episodeId,
        customPath: generalSettings.episodesPath,
        sceneDetectionMethod: generalSettings.sceneDetectionMethod,
        importMethod: generalSettings.importMethod,
      })
        .catch((err) => { invokeError = err; })
        .finally(() => {
          stop();
          if (streamCleanupRef.current === stop) streamCleanupRef.current = null;
        });

      // Whichever happens first: phase-1 done (normal) or the process ending
      // before phase-1 (error, or a video that produced no scenes).
      const winner = await Promise.race([
        phase1Done.then(() => "phase1" as const),
        invokeSettled.then(() => "invoke" as const),
      ]);

      if (winner === "phase1") {
        // Build the entry from the streamed clips already in the store (phase-1
        // paths included); phase-2 patches continue arriving in the background.
        const streamedClips = useAppStateStore.getState().clips;
        const inferredName = streamedClips[0]?.originalName || fileNameFromPath(file);
        const episodeEntry: EpisodeEntry = {
          id: episodeId,
          displayName: inferredName,
          videoPath: file,
          folderId: episodeState.selectedFolderId,
          importedAt: Date.now(),
          clips: streamedClips,
          importMethod: "video_files",
        };
        return { episodeEntry, sceneCount: streamedClips.length };
      }

      // Process ended before any phase-1 signal.
      if (invokeError) throw invokeError;
      // Defensive fallback (no scenes / no phase-1 emitted): detect_scenes already
      // ran above, so skip straight to manifest hydration below.
    } else {
      // Non-streaming path (webp_files, and any non-streaming import): no streaming
      // listeners are wired, so run detection to completion here. This writes the
      // manifest the hydration step below reads. (Without this, brand-new episodes
      // have no manifest on disk and loadEpisodeManifest fails with os error 3.)
      await invoke("detect_scenes", {
        videoPath: file,
        episodeCacheId: episodeId,
        customPath: generalSettings.episodesPath,
        sceneDetectionMethod: generalSettings.sceneDetectionMethod,
        importMethod: generalSettings.importMethod,
      });
    }

    const manifest = await loadEpisodeManifest(episodeId, generalSettings.episodesPath);
    const clips = parseManifestInitialClips(manifest, episodeId);
    if (clips.length === 0) {
      throw new Error("Manifest import path produced no clips.");
    }

    const manifestMethod = manifest?.source?.importMethod;
    const episodeImportMethod: EpisodeEntry["importMethod"] =
      manifestMethod === "webp_files" || manifestMethod === "video_files"
        ? manifestMethod
        : generalSettings.importMethod;

    const inferredName = clips[0]?.originalName || fileNameFromPath(file);
    const episodeEntry: EpisodeEntry = {
      id: episodeId,
      displayName: inferredName,
      videoPath: file,
      folderId: episodeState.selectedFolderId,
      importedAt: Date.now(),
      clips,
      importMethod: episodeImportMethod,
    };

    const sceneCount = Array.isArray(manifest?.scenes) ? manifest.scenes.length : clips.length;
    return { episodeEntry, sceneCount };
  }, [generalSettings.episodesPath, generalSettings.sceneDetectionMethod, generalSettings.importMethod, episodeState.selectedFolderId, startVideoStreamingListeners]);

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

      const { episodeEntry, sceneCount } = await runImportPipeline(file, episodeId, true);

      // Replace (not duplicate) the entry the streaming listener may have added.
      episodeState.setEpisodes((prev) => [episodeEntry, ...prev.filter((ep) => ep.id !== episodeId)]);
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
  }, [appState, episodeState, generalSettings, props?.onRPCUpdate, logImportError, runImportPipeline]);

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
          const { episodeEntry, sceneCount: manifestSceneCount } = await runImportPipeline(file, episodeId);
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
  }, [appState, episodeState, generalSettings, abortedRef, setBgImportProgress, logImportError, runImportPipeline]);

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

