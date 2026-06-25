import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildDemandJob, makeDemandKey, normalizeWebpKind, parseDemandKey } from "./webpQueueUtils";
import { useScenePreviewStore } from "../../stores/scenePreviewStore";
import {
  QueueDemand,
  SceneWebpBatchItem,
  SceneWebpBatchResult,
  WebpDemandInput,
  WebpPrimeJob,
  WebpQueueContext,
} from "./webpQueueTypes";

// Two-lane scheduler:
// - visible tiles: quick batches
// - offscreen tiles: slow background trickle
// Sized to keep the backend's concurrent WebP encode pool (capped at 4) fed
// across a request, amortizing IPC roundtrips.
const VISIBLE_BATCH_SIZE = 8;
const OFFSCREEN_BATCH_SIZE = 1;
const OFFSCREEN_BATCH_DELAY_MS = 250;

const WEBP_DEBUG = false;

function webpLog(message: string, payload?: Record<string, unknown>): void {
  if (!WEBP_DEBUG) return;
  if (payload) {
    console.log(`[WEBP_QUEUE] ${message}`, payload);
    return;
  }
  console.log(`[WEBP_QUEUE] ${message}`);
}

type BatchPlan = {
  batch: QueueDemand[];
  offscreenOnly: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function useViewportAwareWebpQueue(context: WebpQueueContext = {}) {
  // NOTE: intentionally does NOT subscribe to `animatedByClipId`. Each tile reads
  // its own slice (`animatedByClipId[clip.id]`) directly from the store, so a new
  // WebP result re-renders only that tile instead of re-rendering ClipsContainer
  // and reconciling the entire grid on every result (which thrashed scrolling).
  const cacheRef = useRef<Map<string, string>>(new Map());
  const demandRef = useRef<Map<string, QueueDemand>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);
  const processingRef = useRef(false);
  // Hold the latest context in a ref so the returned callbacks can stay
  // referentially stable. The caller passes a fresh `context` object literal on
  // every render; depending on it directly made `primeFromDiskCache` change
  // identity each render, which re-fired the full-episode disk-cache prime on
  // every scroll frame and froze scrolling.
  const contextRef = useRef(context);
  contextRef.current = context;

  const publishResult = useCallback((demandKey: string, path: string) => {
    const { clipId } = parseDemandKey(demandKey);
    useScenePreviewStore.getState().setAnimated(clipId, path);
  }, []);

  const rankCandidates = useCallback((a: QueueDemand, b: QueueDemand): number => {
    const aPriority = a.priority ? 1 : 0;
    const bPriority = b.priority ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    if (a.order !== b.order) return a.order - b.order;
    return b.seq - a.seq;
  }, []);

  const hasVisiblePending = useCallback((): boolean => {
    for (const [demandKey, demand] of demandRef.current) {
      if (!demand.isVisible) continue;
      if (cacheRef.current.has(demandKey)) continue;
      if (inFlightRef.current.has(demandKey)) continue;
      return true;
    }
    return false;
  }, []);

  const pickNextBatch = useCallback((): BatchPlan => {
    const candidates: QueueDemand[] = [];
    for (const [demandKey, demand] of demandRef.current) {
      if (cacheRef.current.has(demandKey)) continue;
      if (inFlightRef.current.has(demandKey)) continue;
      candidates.push(demand);
    }

    const visible = candidates.filter((demand) => demand.isVisible).sort(rankCandidates);
    if (visible.length > 0) {
      webpLog("lane=visible", {
        pendingVisible: visible.length,
        pendingOffscreen: candidates.length - visible.length,
      });
      return {
        batch: visible.slice(0, VISIBLE_BATCH_SIZE),
        offscreenOnly: false,
      };
    }

    const offscreen = candidates.filter((demand) => !demand.isVisible).sort(rankCandidates);
    if (offscreen.length > 0) {
      webpLog("lane=offscreen", {
        pendingOffscreen: offscreen.length,
      });
    }
    return {
      batch: offscreen.slice(0, OFFSCREEN_BATCH_SIZE),
      offscreenOnly: offscreen.length > 0,
    };
  }, [rankCandidates]);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (true) {
        const { batch, offscreenOnly } = pickNextBatch();
        if (batch.length === 0) break;

        webpLog("dispatch batch", {
          size: batch.length,
          offscreenOnly,
          demandKeys: batch.map((demand) => demand.demandKey),
        });

        for (const demand of batch) {
          inFlightRef.current.add(demand.demandKey);
        }

        try {
          const result = await invoke<SceneWebpBatchResult>("generate_scene_webp_batch", {
            jobs: batch.map((demand) => demand.job),
          });

          for (const item of result.items ?? []) {
            // item.sceneId echoes back the demand key we sent.
            if (item.path) {
              cacheRef.current.set(item.sceneId, item.path);
              publishResult(item.sceneId, item.path);
            }
            if (item.error) {
              demandRef.current.delete(item.sceneId);
            }
          }
        } catch {
          for (const demand of batch) {
            demandRef.current.delete(demand.demandKey);
          }
        } finally {
          for (const demand of batch) {
            inFlightRef.current.delete(demand.demandKey);
          }
        }

        // Keep background preloading gentle so scrolling stays responsive.
        if (offscreenOnly && !hasVisiblePending()) {
          webpLog("offscreen cooldown", { delayMs: OFFSCREEN_BATCH_DELAY_MS });
          await sleep(OFFSCREEN_BATCH_DELAY_MS);
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [hasVisiblePending, pickNextBatch, publishResult]);

  const reportWebpDemand = useCallback(
    (clipId: string, demand: WebpDemandInput | null) => {
      if (!demand) {
        // Clearing demand for a clip removes both kinds (tile left viewport).
        demandRef.current.delete(makeDemandKey(clipId, "animated"));
        return;
      }

      const kind = normalizeWebpKind(demand.job.kind);
      const demandKey = makeDemandKey(clipId, kind);

      if (cacheRef.current.has(demandKey)) {
        const cachedPath = cacheRef.current.get(demandKey);
        if (cachedPath) publishResult(demandKey, cachedPath);
        return;
      }

      const seq = ++seqRef.current;
      webpLog("enqueue", {
        clipId,
        demandKey,
        isVisible: demand.isVisible,
        priority: demand.priority,
        order: demand.order,
      });
      demandRef.current.set(demandKey, {
        demandKey,
        clipId,
        kind,
        isVisible: demand.isVisible,
        order: demand.order,
        priority: demand.priority,
        seq,
        // sceneId carries the demand key so the Rust result can be routed back to kind.
        job: buildDemandJob(demandKey, demand.job, kind, contextRef.current),
      });

      void processQueue();
    },
    [processQueue, publishResult]
  );

  const primeFromDiskCache = useCallback(async (jobs: WebpPrimeJob[]) => {
    const context = contextRef.current;
    if (!context.episodeCacheId) {
      webpLog("prime cache skipped", { reason: "missing episodeCacheId" });
      return;
    }
    if (jobs.length === 0) {
      webpLog("prime cache skipped", { reason: "no jobs" });
      return;
    }

    // Skip clips already resolved this session; republish their cached path so a
    // freshly mounted tile still picks it up without another disk round-trip.
    // This keeps re-primes during streaming import (clips array grows) cheap —
    // only genuinely new clips hit the backend.
    const pending: WebpPrimeJob[] = [];
    for (const job of jobs) {
      const cachedPath = cacheRef.current.get(makeDemandKey(job.clipId, "animated"));
      if (cachedPath) {
        publishResult(makeDemandKey(job.clipId, "animated"), cachedPath);
        continue;
      }
      pending.push(job);
    }

    if (pending.length === 0) {
      webpLog("prime cache skipped", { reason: "all cached" });
      return;
    }

    webpLog("prime cache start", {
      episodeCacheId: context.episodeCacheId,
      jobs: pending.length,
      customPath: context.customPath ?? null,
    });

    const lookupJobs = pending.map((job) => {
      const demandKey = makeDemandKey(job.clipId, "animated");
      return buildDemandJob(
        demandKey,
        {
          sourcePath: job.sourcePath,
          start: job.start,
          end: job.end,
          fps: job.fps,
          kind: "animated",
        },
        "animated",
        context
      );
    });

    try {
      const result = await invoke<SceneWebpBatchResult>("lookup_scene_webp_cache_batch", {
        jobs: lookupJobs,
      });

      for (const item of result.items ?? []) {
        const typed = item as SceneWebpBatchItem;
        if (!typed.path) continue;
        cacheRef.current.set(typed.sceneId, typed.path);
        publishResult(typed.sceneId, typed.path);
      }

      webpLog("prime cache complete", {
        episodeCacheId: context.episodeCacheId,
        requested: pending.length,
        hits: (result.items ?? []).filter((item) => Boolean(item.path)).length,
      });
    } catch (error) {
      webpLog("prime cache failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [publishResult]);

  const resetWebpQueue = useCallback(() => {
    cacheRef.current.clear();
    demandRef.current.clear();
    inFlightRef.current.clear();
    useScenePreviewStore.getState().reset();
  }, []);

  return {
    reportWebpDemand,
    primeFromDiskCache,
    resetWebpQueue,
  };
}
