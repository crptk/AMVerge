import { useRef, startTransition, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  const positionToIdRef = useRef(new Map<number, string>());
  const localAbortedRef = useRef(false);
  const abortedRef = props?.abortedRef || localAbortedRef;

  function parseInitialClips(clipsJson: string): ClipItem[] {
    const scenes: any[] = JSON.parse(clipsJson);
    return scenes.map((s, pos) => {
      const id = crypto.randomUUID();
      positionToIdRef.current.set(pos, id);
      return {
        id,
        src: s.path,
        thumbnail: s.thumbnail,
        originalName: s.original_file,
        start: s.start,
        end: s.end,
        thumbnailReady: s.thumbnail_ready !== false,
      };
    });
  }

  function finalizeClips(clips: ClipItem[]): ClipItem[] {
    return clips.map(({ thumbnailReady: _, ...rest }) => rest as ClipItem);
  }

  const handleImport = useCallback(async (file: string | null) => {
    if (!file) return;

    const episodeId = crypto.randomUUID();
    const gen = ++importGenRef.current;
    positionToIdRef.current = new Map();

    // Tracks clip IDs whose thumbnail_ready arrived before clips were committed to the store.
    const pendingThumbnailReadyIds = new Set<string>();

    let thumbReadyCount = 0;
    let thumbReadyBeforeStore = 0;
    let pairResultCount = 0;
    let pairResultBeforeStore = 0;

    // Batched updates: instead of one Zustand setState per event (which triggers a
    // synchronous React re-render via useSyncExternalStore each time), we accumulate
    // all thumbnail_ready and pair_result changes and flush them once per animation frame.
    const batchedThumbIds = new Set<string>();
    const batchedMerges: Array<{ clipAId: string; clipBId: string }> = [];
    let batchRafId: number | null = null;

    const applyBatchedUpdates = (activeEpisodeId: string) => {
      if (importGenRef.current !== gen) return;

      const thumbIds = new Set(batchedThumbIds);
      batchedThumbIds.clear();
      const merges = batchedMerges.splice(0);

      if (thumbIds.size === 0 && merges.length === 0) return;

      console.log(`[batch flush] thumbIds=${thumbIds.size} merges=${merges.length}`);

      useAppStateStore.setState(s => {
        let clips = s.clips;
        let bgProgress = s.bgProgress;
        let changed = false;

        // Apply merges sequentially so chained merges (A→B then B→C) work correctly.
        for (const { clipAId, clipBId } of merges) {
          const removed = clips.find(c => c.id === clipAId);
          if (!removed) continue;
          const removedSrcs = removed.mergedSrcs ?? [removed.src];
          const mergeInto = (c: ClipItem) =>
            c.id !== clipBId ? c : { ...c, mergedSrcs: [...removedSrcs, ...(c.mergedSrcs ?? [c.src])] };
          clips = clips.filter(c => c.id !== clipAId).map(mergeInto);
          changed = true;
        }

        // Apply thumbnail ready flags.
        if (thumbIds.size > 0) {
          let thumbsApplied = 0;
          const newClips = clips.map(c => {
            if (thumbIds.has(c.id) && !c.thumbnailReady) { thumbsApplied++; return { ...c, thumbnailReady: true }; }
            return c;
          });
          if (thumbsApplied > 0) {
            clips = newClips;
            changed = true;
            if (bgProgress) {
              bgProgress = { ...bgProgress, done: Math.min(bgProgress.done + thumbsApplied, bgProgress.total) };
            }
          }
        }

        return changed ? { ...s, clips, bgProgress } : s;
      });

      if (merges.length > 0) {
        useEpisodePanelRuntimeStore.setState(s => ({
          episodes: s.episodes.map(ep => {
            if (ep.id !== activeEpisodeId) return ep;
            let epClips = ep.clips;
            for (const { clipAId, clipBId } of merges) {
              const removed = epClips.find(c => c.id === clipAId);
              if (!removed) continue;
              const removedSrcs = removed.mergedSrcs ?? [removed.src];
              const mergeInto = (c: ClipItem) =>
                c.id !== clipBId ? c : { ...c, mergedSrcs: [...removedSrcs, ...(c.mergedSrcs ?? [c.src])] };
              epClips = epClips.filter(c => c.id !== clipAId).map(mergeInto);
            }
            return epClips === ep.clips ? ep : { ...ep, clips: epClips };
          }),
        }));
      }
    };

    const scheduleBatch = (activeEpisodeId: string) => {
      if (batchRafId !== null) return;
      batchRafId = requestAnimationFrame(() => {
        batchRafId = null;
        applyBatchedUpdates(activeEpisodeId);
      });
    };

    // Flag set by processing_complete to detect the race where it fires before
    // the initial_clips_ready setTimeout has committed clips to the store.
    let processingCompleted = false;

    // pair_result events that arrived before clips were in the store — replayed after commit.
    const pendingMerges: Array<{ clipAId: string; clipBId: string }> = [];

    const unlisteners: Array<() => void> = [];
    let uiUnblocked = false;

    try {
      appState.setProgress(0);
      appState.setProgressMsg("Starting...");
      setLoading(true);
      appState.setSelectedClips(new Set());
      appState.setFocusedClip(null);
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

      const activeEpisodeId = episodeId;

      // ── initial_clips_ready: first batch of clips ready, unblock UI ─────────
      const ul1 = await listen<{ clips_json: string }>("initial_clips_ready", (event) => {
        if (importGenRef.current !== gen) return;

        const clips = parseInitialClips(event.payload.clips_json);
        const inferredName = clips[0]?.originalName || fileNameFromPath(file);

        const episodeEntry: EpisodeEntry = {
          id: activeEpisodeId,
          displayName: inferredName,
          videoPath: file,
          folderId: useEpisodePanelRuntimeStore.getState().selectedFolderId,
          importedAt: Date.now(),
          clips: finalizeClips(clips),
        };

        const notReady = clips.filter(c => c.thumbnailReady === false).length;
        console.log(`[initial_clips_ready] clips=${clips.length} notReady=${notReady} pendingThumbIds=${pendingThumbnailReadyIds.size} uiUnblocked=${uiUnblocked}`);

        // Unblock the UI immediately before any expensive state updates.
        if (!uiUnblocked) {
          uiUnblocked = true;
          setLoading(false);
          if (notReady > 0) {
            useAppStateStore.setState({ bgProgress: { done: clips.length - notReady, total: clips.length } });
          }
          console.log(`[initial_clips_ready] setLoading(false), bgProgress set to ${notReady > 0 ? `{done:${clips.length - notReady}, total:${clips.length}}` : 'null'}`);
        }

        // Add rAF probe to check if paint fires before or after the setTimeout
        const t0 = performance.now();
        requestAnimationFrame(() => {
          console.log(`[rAF probe] first rAF fired at +${(performance.now() - t0).toFixed(1)}ms after setLoading(false)`);
        });

        // Defer expensive updates so React can paint the loading=false frame first.
        setTimeout(() => {
          console.log(`[initial_clips_ready:setTimeout] fired at +${(performance.now() - t0).toFixed(1)}ms after setLoading(false), processingCompleted=${processingCompleted}`);
          if (importGenRef.current !== gen) return;

          // Merge any thumbnail_ready events that fired before clips were in the store.
          const clipsWithPendingThumbs = pendingThumbnailReadyIds.size > 0
            ? clips.map(c => pendingThumbnailReadyIds.has(c.id) ? { ...c, thumbnailReady: true } : c)
            : clips;

          // If processing_complete already ran before this setTimeout, it stripped thumbnailReady
          // from an empty store (race condition). Strip it here so clips are immediately clickable.
          // Also queue any pre-store pair_result merges to be applied after commit.
          const clipsToCommit = processingCompleted ? finalizeClips(clipsWithPendingThumbs) : clipsWithPendingThumbs;
          if (processingCompleted && pendingMerges.length > 0) {
            batchedMerges.push(...pendingMerges);
            pendingMerges.length = 0;
          }

          console.log(`[initial_clips_ready:setTimeout] committing ${clipsToCommit.length} clips to store, pendingIds=${pendingThumbnailReadyIds.size}, pendingMerges=${batchedMerges.length}`);
          const t1 = performance.now();
          useEpisodePanelRuntimeStore.setState(s => ({
            episodes: [episodeEntry, ...s.episodes],
            selectedEpisodeId: activeEpisodeId,
            openedEpisodeId: activeEpisodeId,
          }));
          useAppStateStore.setState({ clips: clipsToCommit });
          console.log(`[initial_clips_ready:setTimeout] setState took ${(performance.now() - t1).toFixed(1)}ms — store now has ${useAppStateStore.getState().clips.length} clips, bgProgress=${JSON.stringify(useAppStateStore.getState().bgProgress)}`);

          // If processing_complete already ran, apply any pending merges now that clips are in the store.
          if (processingCompleted && batchedMerges.length > 0) {
            applyBatchedUpdates(activeEpisodeId);
          }
        }, 0);
      });
      unlisteners.push(ul1);

      // ── thumbnail_ready: one more clip thumbnail is on disk ─────────────────
      const ul2 = await listen<{ position: number }>("thumbnail_ready", (event) => {
        if (importGenRef.current !== gen) return;

        const clipId = positionToIdRef.current.get(event.payload.position);
        if (!clipId) return;

        thumbReadyCount++;
        const inStore = useAppStateStore.getState().clips.some(c => c.id === clipId);

        if (!inStore) {
          // Clip not yet committed to store; track for later and update bgProgress immediately.
          thumbReadyBeforeStore++;
          if (thumbReadyCount <= 10) {
            console.log(`[thumbnail_ready #${thumbReadyCount}] clip NOT in store (beforeStore=${thumbReadyBeforeStore})`);
          }
          pendingThumbnailReadyIds.add(clipId);
          useAppStateStore.setState(s => {
            if (!s.bgProgress) return s;
            return { ...s, bgProgress: { ...s.bgProgress, done: Math.min(s.bgProgress.done + 1, s.bgProgress.total) } };
          });
          return;
        }

        if (thumbReadyCount <= 10) {
          console.log(`[thumbnail_ready #${thumbReadyCount}] clip in store, batching`);
        }
        batchedThumbIds.add(clipId);
        scheduleBatch(activeEpisodeId);
      });
      unlisteners.push(ul2);

      // ── pair_result: merge decision for two adjacent clips ──────────────────
      const ul3 = await listen<{ pos_a: number; pos_b: number; should_merge: boolean }>(
        "pair_result",
        (event) => {
          if (importGenRef.current !== gen) return;
          if (!event.payload.should_merge) return;

          const clipAId = positionToIdRef.current.get(event.payload.pos_a);
          const clipBId = positionToIdRef.current.get(event.payload.pos_b);
          if (!clipAId || !clipBId) return;

          pairResultCount++;
          const clipAInStore = useAppStateStore.getState().clips.some(c => c.id === clipAId);
          if (!clipAInStore) pairResultBeforeStore++;
          if (pairResultCount <= 10) {
            console.log(`[pair_result #${pairResultCount}] clipA in store: ${clipAInStore} (store=${useAppStateStore.getState().clips.length}, beforeStore=${pairResultBeforeStore})`);
          }

          if (!clipAInStore) {
            // Store not populated yet — save for replay after the setTimeout commits clips.
            pendingMerges.push({ clipAId, clipBId });
            return;
          }

          batchedMerges.push({ clipAId, clipBId });
          scheduleBatch(activeEpisodeId);
        }
      );
      unlisteners.push(ul3);

      // ── processing_complete: all thumbnails and pairs done ──────────────────
      const ul4 = await listen<void>("processing_complete", () => {
        if (importGenRef.current !== gen) return;

        processingCompleted = true;

        // Flush any events still waiting in the batch before we finalize.
        if (batchRafId !== null) {
          cancelAnimationFrame(batchRafId);
          batchRafId = null;
        }
        applyBatchedUpdates(activeEpisodeId);

        console.log(`[processing_complete] thumbReady=${thumbReadyCount} (beforeStore=${thumbReadyBeforeStore}), pairResult=${pairResultCount} (beforeStore=${pairResultBeforeStore}), store=${useAppStateStore.getState().clips.length} clips`);

        const finalClips = useAppStateStore.getState().clips.map(c => {
          const { thumbnailReady: _, ...rest } = c;
          return rest as ClipItem;
        });
        useAppStateStore.setState({ clips: finalClips, bgProgress: null });
        useEpisodePanelRuntimeStore.setState(s => ({
          episodes: s.episodes.map(ep =>
            ep.id === activeEpisodeId ? { ...ep, clips: finalClips } : ep
          ),
        }));
      });
      unlisteners.push(ul4);

      // Fire the backend — blocks until the sidecar exits.
      await invoke("detect_scenes", {
        videoPath: file,
        episodeCacheId: episodeId,
        customPath: generalSettings.episodesPath,
      });

    } catch (err) {
      if (importGenRef.current !== gen) return;
      console.error("Detection failed:", err);
      useAppStateStore.setState({ bgProgress: null });
    } finally {
      if (batchRafId !== null) {
        cancelAnimationFrame(batchRafId);
        batchRafId = null;
      }
      unlisteners.forEach(ul => ul());
      if (importGenRef.current === gen && !uiUnblocked) setLoading(false);
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

  const handleExport = useCallback(async (selectedClips: Set<string>, mergeEnabled?: boolean, mergeFileName?: string) => {
    if (selectedClips.size === 0) return;

    const selected = appState.clips.filter((c: ClipItem) => selectedClips.has(c.id));
    console.log(`[handleExport] matched ${selected.length} clips from store`);
    if (selected.length === 0) return;
    const exportProfile = getActiveExportProfile(
      generalSettings.exportProfiles,
      generalSettings.activeExportProfileId
    );
    const resolvedMergeEnabled =
      supportsClipMerge(exportProfile.workflow) && (mergeEnabled ?? exportProfile.mergeEnabled);
    const editorTarget = resolveEditorTarget(exportProfile.editorTarget);
    const workflow = exportProfile.workflow;

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
    handleDownloadSingleClip,
  };
}
