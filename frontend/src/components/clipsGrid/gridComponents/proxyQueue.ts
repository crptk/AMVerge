/**
 * proxyQueue.ts
 *
 * Custom React hook for managing HEVC/H.264 proxy generation and prioritization for video clips.
 * Ensures only visible/needed proxies are generated, and prioritizes hovered/active tiles.
 */
import { useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeferredProxy, ProxyDemand } from "../types.ts"


export default function useViewportAwareProxyQueue() {
  const proxyCacheRef = useRef<Map<string, string>>(new Map());
  const proxyDeferredRef = useRef<Map<string, DeferredProxy>>(new Map());

  // prevents multiple ffmpeg proxy jobs from running at once.
  // running more than one can freeze low-end machines.
  const proxyProcessingRef = useRef(false);

  // tracks demand for proxies (order, priority, recency)
  const proxyDemandRef = useRef<Map<string, ProxyDemand>>(new Map());
  const proxyDemandSeqRef = useRef(0);

  // only one proxy generation in flight at a time
  const proxyInFlightClipRef = useRef<string | null>(null);

  // pick the next clip that should get a proxy (prioritize hovered/visible)
  const pickNextProxyClip = useCallback((): string | null => {
    let best: { clipPath: string; demand: ProxyDemand } | null = null;

    for (const [clipPath, demand] of proxyDemandRef.current) {
      if (!proxyDeferredRef.current.has(clipPath)) continue;
      if (proxyInFlightClipRef.current === clipPath) continue;

      if (!best) {
        best = { clipPath, demand };
        continue;
      }

      const a = demand;
      const b = best.demand;

      // prioritize hovered tiles, then order, then recency
      const aPri = a.priority ? 1 : 0;
      const bPri = b.priority ? 1 : 0;
      if (aPri !== bPri) {
        if (aPri > bPri) best = { clipPath, demand };
        continue;
      }

      if (a.order !== b.order) {
        if (a.order < b.order) best = { clipPath, demand };
        continue;
      }

      if (a.seq !== b.seq) {
        if (a.seq > b.seq) best = { clipPath, demand };
      }
    }

    return best?.clipPath ?? null;
  }, []);

  // main loop: process proxy requests one at a time
  const processProxyQueue = useCallback(async () => {
    if (proxyProcessingRef.current) return;
    proxyProcessingRef.current = true;

    try {
      while (true) {
        const clipPath = pickNextProxyClip();
        if (!clipPath) break;

        // use cached proxy if available
        const cached = proxyCacheRef.current.get(clipPath);
        if (cached) {
          const deferred = proxyDeferredRef.current.get(clipPath);
          if (deferred) {
            deferred.resolve(cached);
            proxyDeferredRef.current.delete(clipPath);
          }
          continue;
        }

        const deferred = proxyDeferredRef.current.get(clipPath);
        if (!deferred) continue;

        try {
          proxyInFlightClipRef.current = clipPath;
          const proxyPath = await invoke<string>("ensure_preview_proxy", { clipPath });
          if (!proxyPath) throw new Error("ensure_preview_proxy returned empty path");

          proxyCacheRef.current.set(clipPath, proxyPath);
          deferred.resolve(proxyPath);
        } catch (err) {
          deferred.reject(err);
        } finally {
          if (proxyInFlightClipRef.current === clipPath) proxyInFlightClipRef.current = null;
          proxyDeferredRef.current.delete(clipPath);
        }
      }
    } finally {
      proxyProcessingRef.current = false;
    }
  }, [pickNextProxyClip]);

  // request a proxy for a clip, optionally with priority (e.g., hovered)
  const requestProxySequential = useCallback(
    (clipPath: string, priority: boolean) => {
      const cached = proxyCacheRef.current.get(clipPath);
      if (cached) return Promise.resolve(cached);

      const existing = proxyDeferredRef.current.get(clipPath);
      if (existing) return existing.promise;

      let resolve!: (proxyPath: string) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      proxyDeferredRef.current.set(clipPath, { promise, resolve, reject });

      // mark demand for this proxy (priority if hovered)
      const seq = ++proxyDemandSeqRef.current;
      const existingDemand = proxyDemandRef.current.get(clipPath);
      proxyDemandRef.current.set(clipPath, {
        order: existingDemand?.order ?? Number.POSITIVE_INFINITY,
        priority: priority || existingDemand?.priority === true,
        seq,
      });

      void processProxyQueue();
      return promise;
    },
    [processProxyQueue]
  );

  // report demand for a proxy (called by tiles as they become visible/hovered)
  const reportProxyDemand = useCallback(
    (clipPath: string, demand: { order: number; priority: boolean } | null) => {
      if (!demand) {
        proxyDemandRef.current.delete(clipPath);

        // if this was enqueued but scrolled offscreen before processing, cancel it.
        const deferred = proxyDeferredRef.current.get(clipPath);
        if (
          deferred &&
          proxyInFlightClipRef.current !== clipPath &&
          !proxyCacheRef.current.has(clipPath)
        ) {
          deferred.reject(new Error("proxy request cancelled (no longer visible)"));
          proxyDeferredRef.current.delete(clipPath);
        }
        return;
      }

      const seq = ++proxyDemandSeqRef.current;
      proxyDemandRef.current.set(clipPath, {
        order: demand.order,
        priority: demand.priority,
        seq,
      });

      void processProxyQueue();
    },
    [processProxyQueue]
  );

  return { requestProxySequential, reportProxyDemand };
}
