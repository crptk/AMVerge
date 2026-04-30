// Drag/drop hook for the Episode Panel. Handles pointer dragging, drop target detection, and move commits.
import { useRef, useState } from "react";
import { EpisodeEntry, EpisodeFolder } from "../../../types/domain"

import type {
  EpisodePanelProps,
  PointerDragSource,
  PointerDropTarget,
} from "../types";

type UseEpisodePanelDragDropArgs = {
  folderById: Map<string, EpisodeFolder>;
  foldersByParentId: Map<string | null, EpisodeFolder[]>;
  episodesByFolderId: Map<string, EpisodeEntry[]>;
  rootEpisodes: EpisodeEntry[];

  multiSelectedIds: Set<string>;
  setMultiSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  clearClickGesture: () => void;
  suppressNextClick: () => void;

  menusOpen: boolean;

  onMoveEpisode: EpisodePanelProps["onMoveEpisode"];
  onMoveFolder: EpisodePanelProps["onMoveFolder"];
};

export default function useEpisodePanelDragDrop({
  folderById,
  foldersByParentId,
  episodesByFolderId,
  rootEpisodes,
  multiSelectedIds,
  setMultiSelectedIds,
  clearClickGesture,
  suppressNextClick,
  menusOpen,
  onMoveEpisode,
  onMoveFolder,
}: UseEpisodePanelDragDropArgs) {
  const [dropTarget, setDropTarget] =
    useState<PointerDropTarget | null>(null);

  const pointerDragRef = useRef<{
    source: PointerDragSource;
    startX: number;
    startY: number;
    dragging: boolean;
    pointerId: number;
  } | null>(null);

  const computeDropTarget = (
    clientX: number,
    clientY: number,
    source: PointerDragSource
  ): PointerDropTarget | null => {
    const el = document.elementFromPoint(
      clientX,
      clientY
    ) as HTMLElement | null;

    if (!el) return null;

    const episodeEl = el.closest("[data-episode-id]") as HTMLElement | null;
    const folderEl = el.closest("[data-folder-id]") as HTMLElement | null;
    const rootEl = el.closest(
      '[data-episode-panel-root="true"]'
    ) as HTMLElement | null;

    if (source.type === "episode") {
      if (episodeEl) {
        const episodeId =
          episodeEl.getAttribute("data-episode-id") || "";

        const folderIdRaw =
          episodeEl.getAttribute("data-episode-folder-id");

        const folderId = folderIdRaw ? folderIdRaw : null;

        if (!episodeId) return null;

        const rect = episodeEl.getBoundingClientRect();

        const insert =
          clientY < rect.top + rect.height / 2
            ? "before"
            : "after";

        return {
          kind: "episode",
          episodeId,
          folderId,
          insert,
        };
      }

      if (folderEl) {
        const folderId =
          folderEl.getAttribute("data-folder-id") || "";

        if (!folderId) return null;

        return { kind: "folder", folderId };
      }

      if (rootEl) return { kind: "root" };

      return null;
    }

    if (folderEl) {
      const folderId =
        folderEl.getAttribute("data-folder-id") || "";

      if (!folderId) return null;

      const rect = folderEl.getBoundingClientRect();
      const third = rect.height / 3;

      if (
        clientY >= rect.top + third &&
        clientY <= rect.bottom - third
      ) {
        return { kind: "folder", folderId };
      }

      const insert =
        clientY < rect.top + rect.height / 2
          ? "before"
          : "after";

      const parentFolderId =
        folderById.get(folderId)?.parentId ?? null;

      return {
        kind: "folder-reorder",
        folderId,
        parentFolderId,
        insert,
      };
    }

    if (rootEl) return { kind: "root" };

    return null;
  };

  const commitDrop = (
    source: PointerDragSource,
    target: PointerDropTarget | null
  ) => {
    if (!target) return;

    if (source.type === "episode") {
      const idsToMove =
        multiSelectedIds.size > 0 &&
        multiSelectedIds.has(source.id)
          ? [...multiSelectedIds]
          : [source.id];

      if (target.kind === "root") {
        for (const id of idsToMove) {
          onMoveEpisode(id, null);
        }

        setMultiSelectedIds(new Set());
        return;
      }

      if (target.kind === "folder") {
        for (const id of idsToMove) {
          onMoveEpisode(id, target.folderId);
        }

        setMultiSelectedIds(new Set());
        return;
      }

      if (target.kind === "episode") {
        if (idsToMove.length === 1) {
          if (target.episodeId === source.id) return;

          const list = target.folderId
            ? episodesByFolderId.get(target.folderId) ?? []
            : rootEpisodes;

          const index = list.findIndex(
            (e) => e.id === target.episodeId
          );

          if (index < 0) return;

          const beforeEpisodeId =
            target.insert === "before"
              ? target.episodeId
              : list[index + 1]?.id;

          onMoveEpisode(
            source.id,
            target.folderId,
            beforeEpisodeId
          );
        } else {
          for (const id of idsToMove) {
            onMoveEpisode(id, target.folderId);
          }

          setMultiSelectedIds(new Set());
        }
      }

      return;
    }

    if (target.kind === "root") {
      onMoveFolder(source.id, null);
      return;
    }

    if (target.kind === "folder") {
      if (target.folderId === source.id) return;

      onMoveFolder(source.id, target.folderId);
      return;
    }

    if (target.kind === "folder-reorder") {
      if (target.folderId === source.id) return;

      const siblings = (
        foldersByParentId.get(target.parentFolderId) ?? []
      ).filter((f) => f.id !== source.id);

      const index = siblings.findIndex(
        (f) => f.id === target.folderId
      );

      if (index < 0) return;

      const beforeFolderId =
        target.insert === "before"
          ? target.folderId
          : siblings[index + 1]?.id;

      onMoveFolder(
        source.id,
        target.parentFolderId,
        beforeFolderId
      );
    }
  };

  const beginPointerDrag =
    (source: PointerDragSource) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (menusOpen) return;

      pointerDragRef.current = {
        source,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        pointerId: e.pointerId,
      };

      (e.currentTarget as HTMLElement).setPointerCapture?.(
        e.pointerId
      );

      let rafId: number | null = null;

      const onMove = (ev: PointerEvent) => {
        const state = pointerDragRef.current;
        if (!state) return;
        if (ev.pointerId !== state.pointerId) return;

        const dx = Math.abs(ev.clientX - state.startX);
        const dy = Math.abs(ev.clientY - state.startY);

        if (!state.dragging && dx + dy > 6) {
          state.dragging = true;
          clearClickGesture();
          suppressNextClick();
        }

        if (!state.dragging) return;

        const cx = ev.clientX;
        const cy = ev.clientY;

        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null;

            const s = pointerDragRef.current;
            if (!s || !s.dragging) return;

            setDropTarget(
              computeDropTarget(cx, cy, s.source)
            );
          });
        }
      };

      const onUpOrCancel = (ev: PointerEvent) => {
        const state = pointerDragRef.current;
        if (!state) return;
        if (ev.pointerId !== state.pointerId) return;

        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        window.removeEventListener(
          "pointermove",
          onMove
        );
        window.removeEventListener(
          "pointerup",
          onUpOrCancel
        );
        window.removeEventListener(
          "pointercancel",
          onUpOrCancel
        );

        pointerDragRef.current = null;

        if (!state.dragging) {
          setDropTarget(null);
          return;
        }

        const finalTarget = computeDropTarget(
          ev.clientX,
          ev.clientY,
          state.source
        );

        commitDrop(state.source, finalTarget);
        setDropTarget(null);
      };

      window.addEventListener(
        "pointermove",
        onMove
      );
      window.addEventListener(
        "pointerup",
        onUpOrCancel
      );
      window.addEventListener(
        "pointercancel",
        onUpOrCancel
      );
    };

  return {
    dropTarget,
    beginPointerDrag,
  };
}