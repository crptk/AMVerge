import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export type Page = "home" | "menu";

const buttons: { name: string; page: Page }[] = [
    {
        name: "Home",
        page: "home",
    },
    {
        name: "Menu",
        page: "menu",
    },
];

type ButtonProps = {
    name: string;
    page: Page;
    activePage: Page;
    setActivePage: React.Dispatch<React.SetStateAction<Page>>;
};

function ButtonComponent({ name, page, activePage, setActivePage }: ButtonProps) {
    return (
        <div className="sidebar-button">
            <button
                onClick={() => setActivePage(page)}
                disabled={activePage === page}
                aria-current={activePage === page ? "page" : undefined}
            >
                {name}
            </button>
        </div>
    )
}

type SidebarProps = {
    activePage: Page;
    setActivePage: React.Dispatch<React.SetStateAction<Page>>;

    episodeFolders: { id: string; name: string; parentId: string | null; isExpanded: boolean }[];
    episodes: {
        id: string;
        displayName: string;
        videoPath: string;
        folderId: string | null;
        importedAt: number;
        clips: { id: string; src: string; thumbnail: string; originalName?: string }[];
    }[];
    selectedEpisodeId: string | null;
    openedEpisodeId: string | null;
    selectedFolderId: string | null;

    onSelectFolder: (folderId: string | null) => void;
    onToggleFolderExpanded: (folderId: string) => void;
    onCreateFolder: (name: string, parentFolderId: string | null) => void;
    onSelectEpisode: (episodeId: string) => void;
    onOpenEpisode: (episodeId: string) => void;
    onDeleteEpisode: (episodeId: string) => void | Promise<void>;
    onRenameEpisode: (episodeId: string, newName: string) => void;
    onRenameFolder: (folderId: string, newName: string) => void;
    onDeleteFolder: (folderId: string) => void;
    onMoveEpisodeToFolder: (episodeId: string, folderId: string | null) => void;
    onMoveEpisode: (episodeId: string, folderId: string | null, beforeEpisodeId?: string) => void;
    onMoveFolder: (folderId: string, parentFolderId: string | null, beforeFolderId?: string) => void;
    onSortEpisodePanel: (direction: "asc" | "desc") => void;
    onClearEpisodePanelCache: () => void | Promise<void>;
};

type EpisodeContextMenuState = {
    episodeId: string;
    x: number;
    y: number;
};

type FolderContextMenuState = {
    folderId: string;
    x: number;
    y: number;
};

type PanelContextMenuState = {
    x: number;
    y: number;
};

type TextModalState = {
    title: string;
    initialValue: string;
    placeholder: string;
    confirmLabel: string;
    onConfirm: (value: string) => void;
};

type ConfirmModalState = {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
};

type PointerDragSource =
    | { type: "episode"; id: string }
    | { type: "folder"; id: string };

type PointerDropTarget =
    | { kind: "root" }
    | { kind: "folder"; folderId: string }
    | { kind: "episode"; episodeId: string; folderId: string | null; insert: "before" | "after" }
    | { kind: "folder-reorder"; folderId: string; parentFolderId: string | null; insert: "before" | "after" };

function EpisodePanel(props: Omit<SidebarProps, "activePage" | "setActivePage">) {
    const [contextMenu, setContextMenu] = useState<EpisodeContextMenuState | null>(null);
    const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
    const [panelContextMenu, setPanelContextMenu] = useState<PanelContextMenuState | null>(null);
    const [textModal, setTextModal] = useState<TextModalState | null>(null);
    const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
    const [nextSortDirection, setNextSortDirection] = useState<"asc" | "desc">("asc");
    const [dropTarget, setDropTarget] = useState<PointerDropTarget | null>(null);
    const panelListRef = useRef<HTMLDivElement | null>(null);
    const textModalInputRef = useRef<HTMLInputElement | null>(null);
    const pointerDragRef = useRef<{
        source: PointerDragSource;
        startX: number;
        startY: number;
        dragging: boolean;
        pointerId: number;
    } | null>(null);
    const suppressClickRef = useRef(false);
    const clickGestureRef = useRef<{ key: string | null; ts: number }>({ key: null, ts: 0 });
    const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
    const lastClickedEpisodeRef = useRef<string | null>(null);

    const clearClickGesture = () => {
        clickGestureRef.current = { key: null, ts: 0 };
    };

    const handleClickWithOptionalDouble = (opts: {
        key: string;
        onSingle: () => void;
        onDouble: () => void;
    }) => {
        return () => {
            if (suppressClickRef.current) return;

            const now = Date.now();
            const state = clickGestureRef.current;
            const isSecondClick = state.key === opts.key && now - state.ts < 260;

            if (isSecondClick) {
                // Suppress the "second" single-click and run the double action.
                clearClickGesture();
                opts.onDouble();
                return;
            }

            // Run single-click immediately.
            clickGestureRef.current = { key: opts.key, ts: now };
            opts.onSingle();
        };
    };

    const handleEpisodeClick = (episodeId: string) => (e: React.MouseEvent) => {
        if (suppressClickRef.current) return;

        if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            setMultiSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(episodeId)) next.delete(episodeId);
                else next.add(episodeId);
                return next;
            });
            lastClickedEpisodeRef.current = episodeId;
            return;
        }

        if (e.shiftKey && lastClickedEpisodeRef.current) {
            e.stopPropagation();
            const startIdx = flatEpisodeOrder.indexOf(lastClickedEpisodeRef.current);
            const endIdx = flatEpisodeOrder.indexOf(episodeId);
            if (startIdx >= 0 && endIdx >= 0) {
                const lo = Math.min(startIdx, endIdx);
                const hi = Math.max(startIdx, endIdx);
                setMultiSelectedIds(new Set(flatEpisodeOrder.slice(lo, hi + 1)));
            }
            return;
        }

        // Normal click – clear multi-select
        setMultiSelectedIds(new Set());
        lastClickedEpisodeRef.current = episodeId;
    };

    const folderById = useMemo(() => {
        const map = new Map<string, (typeof props.episodeFolders)[number]>();
        for (const f of props.episodeFolders) map.set(f.id, f);
        return map;
    }, [props.episodeFolders]);

    const foldersByParentId = useMemo(() => {
        const map = new Map<string | null, (typeof props.episodeFolders)[number][]>();
        for (const folder of props.episodeFolders) {
            const key = folder.parentId ?? null;
            const list = map.get(key) ?? [];
            list.push(folder);
            map.set(key, list);
        }
        return map;
    }, [props.episodeFolders]);

    useEffect(() => {
        if (!contextMenu && !folderContextMenu && !panelContextMenu && !textModal && !confirmModal) return;

        const onWindowClick = () => {
            setContextMenu(null);
            setFolderContextMenu(null);
            setPanelContextMenu(null);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setContextMenu(null);
                setFolderContextMenu(null);
                setPanelContextMenu(null);
                setTextModal(null);
                setConfirmModal(null);
            }
        };

        window.addEventListener("click", onWindowClick);
        window.addEventListener("contextmenu", onWindowClick);
        window.addEventListener("keydown", onKeyDown);

        return () => {
            window.removeEventListener("click", onWindowClick);
            window.removeEventListener("contextmenu", onWindowClick);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [contextMenu, folderContextMenu, panelContextMenu, textModal, confirmModal]);

    useEffect(() => {
        if (!textModal) return;
        window.setTimeout(() => {
            textModalInputRef.current?.focus();
            textModalInputRef.current?.select();
        }, 0);
    }, [textModal]);

    const rootEpisodes = useMemo(
        () => props.episodes.filter((e) => e.folderId === null),
        [props.episodes]
    );

    const episodesByFolderId = useMemo(() => {
        const map = new Map<string, typeof props.episodes>();
        for (const episode of props.episodes) {
            if (!episode.folderId) continue;
            const existing = map.get(episode.folderId) ?? [];
            existing.push(episode);
            map.set(episode.folderId, existing);
        }
        return map;
    }, [props.episodes]);

    const flatEpisodeOrder = useMemo(() => {
        const order: string[] = [];
        const visitFolder = (parentId: string | null) => {
            const childFolders = foldersByParentId.get(parentId) ?? [];
            for (const folder of childFolders) {
                if (folder.isExpanded) {
                    visitFolder(folder.id);
                    const eps = episodesByFolderId.get(folder.id) ?? [];
                    for (const ep of eps) order.push(ep.id);
                }
            }
        };
        visitFolder(null);
        for (const ep of rootEpisodes) order.push(ep.id);
        return order;
    }, [foldersByParentId, episodesByFolderId, rootEpisodes, props.episodeFolders]);

    const openContextMenu = (episodeId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        clearClickGesture();

        setFolderContextMenu(null);
        setPanelContextMenu(null);

        // If right-clicking a non-multi-selected episode, clear multi-select
        if (multiSelectedIds.size > 0 && !multiSelectedIds.has(episodeId)) {
            setMultiSelectedIds(new Set());
        }

        props.onSelectEpisode(episodeId);
        setContextMenu({
            episodeId,
            x: e.clientX,
            y: e.clientY,
        });
    };

    const openFolderContextMenu = (folderId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        clearClickGesture();

        setContextMenu(null);
        setPanelContextMenu(null);

        props.onSelectFolder(folderId);
        setFolderContextMenu({
            folderId,
            x: e.clientX,
            y: e.clientY,
        });
    };

    const openPanelContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        clearClickGesture();
        setContextMenu(null);
        setFolderContextMenu(null);
        setTextModal(null);
        setConfirmModal(null);

        setPanelContextMenu({ x: e.clientX, y: e.clientY });
    };

    const openNewFolderModal = (parentFolderId: string | null) => {
        setPanelContextMenu(null);
        setContextMenu(null);
        setFolderContextMenu(null);

        setTextModal({
            title: "New Folder",
            initialValue: "",
            placeholder: "Folder name",
            confirmLabel: "Create",
            onConfirm: (value) => {
                props.onCreateFolder(value, parentFolderId);
            },
        });
    };

    const openRenameEpisodeModal = (episodeId: string) => {
        const target = props.episodes.find((ep) => ep.id === episodeId);
        if (!target) return;

        setPanelContextMenu(null);
        setContextMenu(null);
        setFolderContextMenu(null);

        setTextModal({
            title: "Rename Episode",
            initialValue: target.displayName,
            placeholder: "Episode name",
            confirmLabel: "Rename",
            onConfirm: (value) => {
                props.onRenameEpisode(episodeId, value);
            },
        });
    };

    const openRenameFolderModal = (folderId: string) => {
        const target = props.episodeFolders.find((f) => f.id === folderId);
        if (!target) return;

        setPanelContextMenu(null);
        setContextMenu(null);
        setFolderContextMenu(null);

        setTextModal({
            title: "Rename Folder",
            initialValue: target.name,
            placeholder: "Folder name",
            confirmLabel: "Rename",
            onConfirm: (value) => {
                props.onRenameFolder(folderId, value);
            },
        });
    };

    const openClearConfirmModal = () => {
        setConfirmModal({
            title: "Clear Episode Panel Cache",
            message: "Are you sure you want to clear the episode panel cache? This will remove cached episodes and free disk space.",
            confirmLabel: "Yes",
            onConfirm: () => {
                void props.onClearEpisodePanelCache();
            },
        });
    };

    const suppressNextClick = () => {
        suppressClickRef.current = true;
        window.setTimeout(() => {
            suppressClickRef.current = false;
        }, 0);
    };

    const computeDropTarget = (clientX: number, clientY: number, source: PointerDragSource): PointerDropTarget | null => {
        const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        if (!el) return null;

        const episodeEl = el.closest("[data-episode-id]") as HTMLElement | null;
        const folderEl = el.closest("[data-folder-id]") as HTMLElement | null;
        const rootEl = el.closest('[data-episode-panel-root="true"]') as HTMLElement | null;

        if (source.type === "episode") {
            if (episodeEl) {
                const episodeId = episodeEl.getAttribute("data-episode-id") || "";
                const folderIdRaw = episodeEl.getAttribute("data-episode-folder-id");
                const folderId = folderIdRaw ? folderIdRaw : null;
                if (!episodeId) return null;

                const rect = episodeEl.getBoundingClientRect();
                const insert = clientY < rect.top + rect.height / 2 ? "before" : "after";
                return { kind: "episode", episodeId, folderId, insert };
            }

            if (folderEl) {
                const folderId = folderEl.getAttribute("data-folder-id") || "";
                if (!folderId) return null;
                return { kind: "folder", folderId };
            }

            if (rootEl) return { kind: "root" };
            return null;
        }

        // source.type === "folder"
        if (folderEl) {
            const folderId = folderEl.getAttribute("data-folder-id") || "";
            if (!folderId) return null;

            const rect = folderEl.getBoundingClientRect();
            const third = rect.height / 3;

            // Middle third = "drop into folder" (nest).
            if (clientY >= rect.top + third && clientY <= rect.bottom - third) {
                return { kind: "folder", folderId };
            }

            const insert = clientY < rect.top + rect.height / 2 ? "before" : "after";
            const parentFolderId = folderById.get(folderId)?.parentId ?? null;
            return { kind: "folder-reorder", folderId, parentFolderId, insert };
        }

        if (rootEl) return { kind: "root" };

        return null;
    };

    const commitDrop = (source: PointerDragSource, target: PointerDropTarget | null) => {
        if (!target) return;

        if (source.type === "episode") {
            const idsToMove = multiSelectedIds.size > 0 && multiSelectedIds.has(source.id)
                ? [...multiSelectedIds]
                : [source.id];

            if (target.kind === "root") {
                for (const id of idsToMove) props.onMoveEpisode(id, null);
                setMultiSelectedIds(new Set());
                return;
            }

            if (target.kind === "folder") {
                for (const id of idsToMove) props.onMoveEpisode(id, target.folderId);
                setMultiSelectedIds(new Set());
                return;
            }

            if (target.kind === "episode") {
                if (idsToMove.length === 1) {
                    if (target.episodeId === source.id) return;

                    const list = target.folderId
                        ? (episodesByFolderId.get(target.folderId) ?? [])
                        : rootEpisodes;
                    const index = list.findIndex((e) => e.id === target.episodeId);
                    if (index < 0) return;

                    const beforeEpisodeId =
                        target.insert === "before"
                            ? target.episodeId
                            : list[index + 1]?.id;

                    props.onMoveEpisode(source.id, target.folderId, beforeEpisodeId);
                } else {
                    // Multi-drag onto an episode row → move all into the same folder
                    for (const id of idsToMove) props.onMoveEpisode(id, target.folderId);
                    setMultiSelectedIds(new Set());
                }
            }

            return;
        }

        // source.type === "folder"
        if (target.kind === "root") {
            props.onMoveFolder(source.id, null);
            return;
        }

        if (target.kind === "folder") {
            if (target.folderId === source.id) return;
            props.onMoveFolder(source.id, target.folderId);
            return;
        }

        if (target.kind === "folder-reorder") {
            if (target.folderId === source.id) return;

            const siblings = (foldersByParentId.get(target.parentFolderId) ?? []).filter((f) => f.id !== source.id);
            const index = siblings.findIndex((f) => f.id === target.folderId);
            if (index < 0) return;

            const beforeFolderId =
                target.insert === "before"
                    ? target.folderId
                    : siblings[index + 1]?.id;

            props.onMoveFolder(source.id, target.parentFolderId, beforeFolderId);
        }
    };

    const beginPointerDrag = (source: PointerDragSource) => (e: React.PointerEvent) => {
        // Only primary button
        if (e.button !== 0) return;

        // Don’t start drag while context menu is open.
        if (contextMenu || folderContextMenu || panelContextMenu || textModal || confirmModal) return;

        // Let clicks still work unless we cross a movement threshold.
        pointerDragRef.current = {
            source,
            startX: e.clientX,
            startY: e.clientY,
            dragging: false,
            pointerId: e.pointerId,
        };

        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

        let rafId: number | null = null;

        const onMove = (ev: PointerEvent) => {
            const state = pointerDragRef.current;
            if (!state) return;
            if (ev.pointerId !== state.pointerId) return;

            const dx = Math.abs(ev.clientX - state.startX);
            const dy = Math.abs(ev.clientY - state.startY);
            if (!state.dragging && dx + dy > 6) {
                state.dragging = true;
                // Once we cross into "dragging", stop interpreting this gesture as a click sequence.
                clearClickGesture();
                suppressNextClick();
            }

            if (!state.dragging) return;

            // Throttle drop-target computation to once per animation frame.
            const cx = ev.clientX;
            const cy = ev.clientY;
            if (rafId === null) {
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    const s = pointerDragRef.current;
                    if (!s || !s.dragging) return;
                    const next = computeDropTarget(cx, cy, s.source);
                    setDropTarget(next);
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

            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUpOrCancel);
            window.removeEventListener("pointercancel", onUpOrCancel);

            pointerDragRef.current = null;

            if (!state.dragging) {
                setDropTarget(null);
                return;
            }

            const finalTarget = computeDropTarget(ev.clientX, ev.clientY, state.source);
            commitDrop(state.source, finalTarget);
            setDropTarget(null);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUpOrCancel);
        window.addEventListener("pointercancel", onUpOrCancel);
    };

    const onPanelKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "F2") {
            if (props.selectedEpisodeId) {
                e.preventDefault();
                openRenameEpisodeModal(props.selectedEpisodeId);
                return;
            }
            if (props.selectedFolderId) {
                e.preventDefault();
                openRenameFolderModal(props.selectedFolderId);
            }
            return;
        }

        if (e.key === "Delete") {
            if (multiSelectedIds.size > 0) {
                e.preventDefault();
                for (const id of multiSelectedIds) {
                    void props.onDeleteEpisode(id);
                }
                setMultiSelectedIds(new Set());
                return;
            }
            if (props.selectedEpisodeId) {
                e.preventDefault();
                void props.onDeleteEpisode(props.selectedEpisodeId);
                return;
            }
            if (props.selectedFolderId) {
                e.preventDefault();
                props.onDeleteFolder(props.selectedFolderId);
            }
        }
    };

    return (
        <div className="eps-container">
            <div className="episode-panel">
                <div className="episode-panel-header">
                    <div className="episode-panel-title">Episode Panel</div>
                    <div className="episode-panel-actions">
                        <button
                            type="button"
                            className="episode-panel-action"
                            onClick={() => {
                                props.onSortEpisodePanel(nextSortDirection);
                                setNextSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
                            }}
                            title={nextSortDirection === "asc" ? "Sort A–Z" : "Sort Z–A"}
                        >
                            Sort A–Z {nextSortDirection === "asc" ? "↑" : "↓"}
                        </button>
                        <button
                            type="button"
                            className="episode-panel-action"
                            onClick={() => openNewFolderModal(null)}
                            title="New folder"
                        >
                            New Folder
                        </button>
                        <button
                            type="button"
                            className="episode-panel-action"
                            onClick={() => {
                                openClearConfirmModal();
                            }}
                            title="Clear episode panel cache"
                        >
                            Clear
                        </button>
                    </div>
                </div>

                <div
                    className={
                        dropTarget?.kind === "root"
                            ? "episode-panel-list is-drop-target-root"
                            : "episode-panel-list"
                    }
                    tabIndex={0}
                    ref={panelListRef}
                    onKeyDown={onPanelKeyDown}
                    onMouseDown={() => panelListRef.current?.focus()}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            props.onSelectFolder(null);
                            setMultiSelectedIds(new Set());
                        }
                    }}
                    onContextMenu={(e) => {
                        if (e.target !== e.currentTarget) return;
                        openPanelContextMenu(e);
                    }}
                    data-episode-panel-root="true"
                >
                    {(() => {
                        const renderEpisodeRow = (
                            episode: (typeof props.episodes)[number],
                            folderId: string | null,
                            depth: number
                        ) => {
                            const isOpen = props.openedEpisodeId === episode.id;
                            const isSelected = props.selectedEpisodeId === episode.id;
                            const isMultiSelected = multiSelectedIds.has(episode.id);
                            const isDrop = dropTarget?.kind === "episode" && dropTarget.episodeId === episode.id;

                            let rowClass = "episode-panel-row episode-row";
                            if (isOpen) rowClass += " is-open";
                            else if (isSelected) rowClass += " is-focused";
                            if (isMultiSelected) rowClass += " is-multi-selected";
                            if (isDrop) rowClass += " is-drop-target";

                            return (
                                <div
                                    key={episode.id}
                                    className={rowClass}
                                    data-episode-id={episode.id}
                                    data-episode-folder-id={folderId ?? ""}
                                    style={{ paddingLeft: `${8 + depth * 12 + 28}px` }}
                                    onPointerDown={beginPointerDrag({ type: "episode", id: episode.id })}
                                    onClick={handleEpisodeClick(episode.id)}
                                    onDoubleClick={() => props.onOpenEpisode(episode.id)}
                                    onContextMenu={(e) => openContextMenu(episode.id, e)}
                                    title={episode.videoPath}
                                >
                                    <span className="episode-panel-episode-name">{episode.displayName}</span>
                                </div>
                            );
                        };

                        const renderFolder = (folder: (typeof props.episodeFolders)[number], depth: number) => {
                            const folderEpisodes = episodesByFolderId.get(folder.id) ?? [];
                            const childFolders = foldersByParentId.get(folder.id) ?? [];

                            const isDropFolder =
                                (dropTarget?.kind === "folder" && dropTarget.folderId === folder.id) ||
                                (dropTarget?.kind === "folder-reorder" && dropTarget.folderId === folder.id);

                            const folderRowClass =
                                (props.selectedFolderId === folder.id
                                    ? "episode-panel-row folder-row is-selected"
                                    : "episode-panel-row folder-row") + (isDropFolder ? " is-drop-target" : "");

                            return (
                                <div key={folder.id} className="episode-panel-folder">
                                    <div
                                        className={folderRowClass}
                                        data-folder-id={folder.id}
                                        onPointerDown={beginPointerDrag({ type: "folder", id: folder.id })}
                                        onClick={handleClickWithOptionalDouble({
                                            key: `folder:${folder.id}`,
                                            onSingle: () => props.onSelectFolder(folder.id),
                                            onDouble: () => {
                                                props.onToggleFolderExpanded(folder.id);
                                                props.onSelectFolder(null);
                                            },
                                        })}
                                        onContextMenu={(e) => openFolderContextMenu(folder.id, e)}
                                        title={folder.name}
                                        style={{ paddingLeft: `${8 + depth * 12}px` }}
                                    >
                                        <button
                                            type="button"
                                            className={
                                                folder.isExpanded
                                                    ? "episode-panel-caret is-expanded"
                                                    : "episode-panel-caret"
                                            }
                                            draggable={false}
                                            onPointerDown={(e) => {
                                                // Prevent the folder row's pointer-capture/drag handler from
                                                // swallowing the first click on the caret.
                                                e.stopPropagation();
                                            }}
                                            onMouseDown={(e) => {
                                                // Keep the caret from taking focus and selecting the folder row.
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                props.onToggleFolderExpanded(folder.id);
                                            }}
                                            aria-label={folder.isExpanded ? "Collapse folder" : "Expand folder"}
                                        >
                                            ▸
                                        </button>
                                        <span className="episode-panel-folder-name">{folder.name}</span>
                                        {/* <span className="episode-panel-count">{folderEpisodes.length}</span> */}
                                    </div>

                                    {folder.isExpanded && (childFolders.length > 0 || folderEpisodes.length > 0) && (
                                        <div className="episode-panel-folder-children">
                                            {childFolders.map((child) => renderFolder(child, depth + 1))}
                                            {folderEpisodes.map((episode) => renderEpisodeRow(episode, folder.id, depth + 1))}
                                        </div>
                                    )}
                                </div>
                            );
                        };

                        const rootFolders = foldersByParentId.get(null) ?? [];
                        return rootFolders.map((folder) => renderFolder(folder, 0));
                    })()}

                    {rootEpisodes.map((episode) => {
                        const isOpen = props.openedEpisodeId === episode.id;
                        const isSelected = props.selectedEpisodeId === episode.id;
                        const isMultiSelected = multiSelectedIds.has(episode.id);
                        const isDrop = dropTarget?.kind === "episode" && dropTarget.episodeId === episode.id;

                        let rowClass = "episode-panel-row episode-row";
                        if (isOpen) rowClass += " is-open";
                        else if (isSelected) rowClass += " is-focused";
                        if (isMultiSelected) rowClass += " is-multi-selected";
                        if (isDrop) rowClass += " is-drop-target";

                        return (
                            <div
                                key={episode.id}
                                className={rowClass}
                                data-episode-id={episode.id}
                                data-episode-folder-id=""
                                onPointerDown={beginPointerDrag({ type: "episode", id: episode.id })}
                                onClick={handleEpisodeClick(episode.id)}
                                onDoubleClick={() => props.onOpenEpisode(episode.id)}
                                onContextMenu={(e) => openContextMenu(episode.id, e)}
                                title={episode.videoPath}
                            >
                                <span className="episode-panel-episode-name">{episode.displayName}</span>
                            </div>
                        );
                    })}
                </div>

                {panelContextMenu && (
                    <div
                        className="episode-context-menu"
                        style={{ left: panelContextMenu.x, top: panelContextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="episode-context-menu-item"
                            onClick={() => {
                                openNewFolderModal(null);
                                setPanelContextMenu(null);
                            }}
                        >
                            Add Folder
                        </button>
                    </div>
                )}

                {textModal && (
                    <div
                        className="episode-modal-overlay"
                        onMouseDown={() => setTextModal(null)}
                    >
                        <div
                            className="episode-modal"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="episode-modal-title">{textModal.title}</div>
                            <input
                                ref={textModalInputRef}
                                className="episode-modal-input"
                                placeholder={textModal.placeholder}
                                defaultValue={textModal.initialValue}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") setTextModal(null);
                                    if (e.key === "Enter") {
                                        const value = (e.currentTarget.value ?? "").trim();
                                        if (!value) return;
                                        textModal.onConfirm(value);
                                        setTextModal(null);
                                    }
                                }}
                            />
                            <div className="episode-modal-actions">
                                <button
                                    type="button"
                                    className="episode-modal-btn"
                                    onClick={() => setTextModal(null)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="episode-modal-btn primary"
                                    onClick={() => {
                                        const value = (textModalInputRef.current?.value ?? "").trim();
                                        if (!value) return;
                                        textModal.onConfirm(value);
                                        setTextModal(null);
                                    }}
                                >
                                    {textModal.confirmLabel}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {confirmModal && (
                    <div
                        className="episode-modal-overlay"
                        onMouseDown={() => setConfirmModal(null)}
                    >
                        <div
                            className="episode-modal"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="episode-modal-title">{confirmModal.title}</div>
                            <div className="episode-modal-message">{confirmModal.message}</div>
                            <div className="episode-modal-actions">
                                <button
                                    type="button"
                                    className="episode-modal-btn"
                                    onClick={() => setConfirmModal(null)}
                                >
                                    No
                                </button>
                                <button
                                    type="button"
                                    className="episode-modal-btn primary"
                                    onClick={() => {
                                        confirmModal.onConfirm();
                                        setConfirmModal(null);
                                    }}
                                >
                                    {confirmModal.confirmLabel}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {contextMenu && (
                    <div
                        className="episode-context-menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.episodeId) ? (
                            <>
                                <button
                                    type="button"
                                    className="episode-context-menu-item"
                                    onClick={() => {
                                        for (const id of multiSelectedIds) {
                                            void props.onDeleteEpisode(id);
                                        }
                                        setMultiSelectedIds(new Set());
                                        setContextMenu(null);
                                    }}
                                >
                                    Delete {multiSelectedIds.size} episodes
                                </button>
                                <div className="episode-context-menu-separator" />
                                <div className="episode-context-menu-label">Move to</div>
                                <button
                                    type="button"
                                    className="episode-context-menu-item"
                                    onClick={() => {
                                        for (const id of multiSelectedIds) {
                                            props.onMoveEpisodeToFolder(id, null);
                                        }
                                        setMultiSelectedIds(new Set());
                                        setContextMenu(null);
                                    }}
                                >
                                    Root
                                </button>
                                {props.episodeFolders.map((folder) => (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        className="episode-context-menu-item"
                                        onClick={() => {
                                            for (const id of multiSelectedIds) {
                                                props.onMoveEpisodeToFolder(id, folder.id);
                                            }
                                            setMultiSelectedIds(new Set());
                                            setContextMenu(null);
                                        }}
                                    >
                                        {folder.name}
                                    </button>
                                ))}
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="episode-context-menu-item"
                                    onClick={() => {
                                        openRenameEpisodeModal(contextMenu.episodeId);
                                        setContextMenu(null);
                                    }}
                                >
                                    Rename
                                </button>
                                <button
                                    type="button"
                                    className="episode-context-menu-item"
                                    onClick={() => {
                                        void props.onDeleteEpisode(contextMenu.episodeId);
                                        setContextMenu(null);
                                    }}
                                >
                                    Delete
                                </button>
                            </>
                        )}
                    </div>
                )}

                {folderContextMenu && (
                    <div
                        className="episode-context-menu"
                        style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="episode-context-menu-item"
                            onClick={() => {
                                openRenameFolderModal(folderContextMenu.folderId);
                                setFolderContextMenu(null);
                            }}
                        >
                            Rename
                        </button>
                        <button
                            type="button"
                            className="episode-context-menu-item"
                            onClick={() => {
                                props.onDeleteFolder(folderContextMenu.folderId);
                                setFolderContextMenu(null);
                            }}
                        >
                            Delete
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function Sidebar({ activePage, setActivePage, ...episodePanelProps }: SidebarProps) {
    return (
        <div className="sidebar-container">
            {
                buttons.map((button) => (
                    <ButtonComponent
                        key={button.page}
                        name={button.name}
                        page={button.page}
                        activePage={activePage}
                        setActivePage={setActivePage}
                    />
                ))    
            }
            <EpisodePanel {...episodePanelProps} />
        </div>
    )
}