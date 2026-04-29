import { EpisodeEntry, EpisodeFolder } from "../types/domain";
import { startTransition }  from "react";
import { useAppStateStore } from "../store/appStore";
import { useEpisodePanelMetadataStore, useEpisodePanelRuntimeStore } from "../store/episodeStore";

export default function useEpisodePanelState() {
	const episodes = useEpisodePanelRuntimeStore(s => s.episodes);
	const setEpisodes = useEpisodePanelRuntimeStore(s => s.setEpisodes);

	const selectedEpisodeId = useEpisodePanelRuntimeStore(s => s.selectedEpisodeId);
	const setSelectedEpisodeId = useEpisodePanelRuntimeStore(s => s.setSelectedEpisodeId);

	const episodeFolders = useEpisodePanelMetadataStore(s => s.episodeFolders);
	const setEpisodeFolders = useEpisodePanelMetadataStore(s => s.setEpisodeFolders);

	const openedEpisodeId = useEpisodePanelRuntimeStore(s => s.openedEpisodeId);
	const setOpenedEpisodeId = useEpisodePanelRuntimeStore(s => s.setOpenedEpisodeId);

	const selectedFolderId = useEpisodePanelRuntimeStore(s => s.selectedFolderId);
	const setSelectedFolderId = useEpisodePanelRuntimeStore(s => s.setSelectedFolderId);

	const setFocusedClip = useAppStateStore(s => s.setFocusedClip);
	const setSelectedClips = useAppStateStore(s => s.setSelectedClips);
	const setClips = useAppStateStore(s => s.setClips);
	const setImportedVideoPath = useAppStateStore(s => s.setImportedVideoPath);
	const setImportToken = useAppStateStore(s => s.setImportToken)

	// Handlers
	const handleSelectEpisode = (episodeId: string) => {
		setSelectedEpisodeId(episodeId);
		setSelectedFolderId(null);
	};

	const handleOpenEpisode = (episodeId: string) => {
		const selectedEpisode = episodes.find((e) => e.id === episodeId);
		if (!selectedEpisode) return;


		setSelectedClips(new Set());
		setFocusedClip(null);
		setSelectedEpisodeId(episodeId);
		setOpenedEpisodeId(episodeId);
		setSelectedFolderId(null);
		setImportedVideoPath(selectedEpisode.videoPath);
		setImportToken(Date.now().toString());

		startTransition(() => {
			setClips(selectedEpisode.clips);
		});
		console.log(selectedEpisode.clips);
	};

	const handleSelectFolder = (folderId: string | null) => {
		setSelectedFolderId(folderId);
		setSelectedEpisodeId(null);
	};

	const handleMoveEpisodeToFolder = (episodeId: string, folderId: string | null) => {
		setEpisodes((prev) =>
			prev.map((e) => (e.id === episodeId ? { ...e, folderId } : e))
		);
	};

	const handleMoveEpisode = (
		episodeId: string,
		folderId: string | null,
		beforeEpisodeId?: string
	) => {
		setEpisodes((prev) => {
			const fromIndex = prev.findIndex((e) => e.id === episodeId);
			if (fromIndex === -1) return prev;

			const moving = { ...prev[fromIndex], folderId };
			const remaining = prev.filter((e) => e.id !== episodeId);

			if (!beforeEpisodeId) {
				return [moving, ...remaining];
			}

			const toIndex = remaining.findIndex((e) => e.id === beforeEpisodeId);
			if (toIndex === -1) {
				return [moving, ...remaining];
			}

			return [...remaining.slice(0, toIndex), moving, ...remaining.slice(toIndex)];
		});
	};

	const handleMoveFolder = (folderId: string, parentFolderId: string | null, beforeFolderId?: string) => {
		setEpisodeFolders((prev) => {
			const byId = new Map(prev.map((f) => [f.id, f] as const));
			const moving = byId.get(folderId);
			if (!moving) return prev;

			// Prevent cycles: cannot move a folder into itself or any of its descendants.
			if (parentFolderId) {
				let cursor: string | null = parentFolderId;
				while (cursor) {
					if (cursor === folderId) return prev;
					const nextParent: string | null = byId.get(cursor)?.parentId ?? null;
					cursor = nextParent;
				}
			}

			const updatedMoving: EpisodeFolder = { ...moving, parentId: parentFolderId };
			const remaining = prev.filter((f) => f.id !== folderId);

			const indexOf = (id: string) => remaining.findIndex((f) => f.id === id);

			let insertIndex = -1;
			if (beforeFolderId) {
				insertIndex = indexOf(beforeFolderId);
			}

			if (insertIndex === -1) {
				if (parentFolderId === null) {
					// Insert at the start of root folders.
					insertIndex = remaining.findIndex((f) => (f.parentId ?? null) === null);
					if (insertIndex === -1) insertIndex = 0;
				} else {
					// Insert at the start of the parent's children if present, else right after the parent.
					insertIndex = remaining.findIndex((f) => (f.parentId ?? null) === parentFolderId);
					if (insertIndex === -1) {
						const parentIndex = indexOf(parentFolderId);
						insertIndex = parentIndex === -1 ? 0 : parentIndex + 1;
					}
				}
			}

			return [...remaining.slice(0, insertIndex), updatedMoving, ...remaining.slice(insertIndex)];
		});
	};

	const handleSortEpisodePanel = (direction: "asc" | "desc") => {
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
		const mult = direction === "asc" ? 1 : -1;

		const folders = episodeFolders;
		const episodesSnapshot = episodes;

		const foldersByParent = new Map<string | null, EpisodeFolder[]>();
		for (const folder of folders) {
			const key = folder.parentId ?? null;
			const list = foldersByParent.get(key) ?? [];
			list.push(folder);
			foldersByParent.set(key, list);
		}

		for (const list of foldersByParent.values()) {
			list.sort((a, b) => mult * collator.compare(a.name, b.name));
		}

		const episodesByFolder = new Map<string | null, EpisodeEntry[]>();
		for (const ep of episodesSnapshot) {
			const key = ep.folderId;
			const list = episodesByFolder.get(key) ?? [];
			list.push(ep);
			episodesByFolder.set(key, list);
		}

		for (const list of episodesByFolder.values()) {
			list.sort((a, b) => mult * collator.compare(a.displayName, b.displayName));
		}

		const sortedFolders: EpisodeFolder[] = [];
		const visit = (folder: EpisodeFolder) => {
			sortedFolders.push(folder);
			const children = foldersByParent.get(folder.id) ?? [];
			for (const child of children) visit(child);
		};

		for (const root of foldersByParent.get(null) ?? []) visit(root);
		setEpisodeFolders(sortedFolders);

		setEpisodes(() => {
			const result: EpisodeEntry[] = [];

			// Root episodes (shown after folders in the UI).
			result.push(...(episodesByFolder.get(null) ?? []));

			// Episodes for every folder in depth-first order.
			for (const folder of sortedFolders) {
				result.push(...(episodesByFolder.get(folder.id) ?? []));
			}

			// Any stray episodes with unknown folderId (shouldn't happen) keep at end.
			for (const [key, list] of episodesByFolder) {
				if (key === null) continue;
				if (sortedFolders.some((f) => f.id === key)) continue;
				result.push(...list);
			}

			return result;
		});
	};

	const handleRenameEpisode = (episodeId: string, newName: string) => {
		const trimmed = (newName ?? "").trim();
		if (!trimmed) return;
		setEpisodes((prev) => prev.map((e) => (e.id === episodeId ? { ...e, displayName: trimmed } : e)));
	};

	const handleRenameFolder = (folderId: string, newName: string) => {
		const trimmed = (newName ?? "").trim();
		if (!trimmed) return;
		setEpisodeFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)));
	};

	const handleDeleteFolder = (folderId: string) => {
		setEpisodeFolders((prev) =>
			prev
				.filter((f) => f.id !== folderId)
				.map((f) => (f.parentId === folderId ? { ...f, parentId: null } : f))
		);
		setEpisodes((prev) => prev.map((e) => (e.folderId === folderId ? { ...e, folderId: null } : e)));
		if (selectedFolderId === folderId) setSelectedFolderId(null);
	};

	const handleDeleteEpisode = (episodeId: string) => {
		setEpisodes((prev) => prev.filter((e) => e.id !== episodeId));
		if (selectedEpisodeId === episodeId) setSelectedEpisodeId(null);
		if (openedEpisodeId === episodeId) setOpenedEpisodeId(null);
	};

	const handleCreateFolder = (name: string, parentFolderId: string | null) => {
		const trimmed = (name ?? "").trim();
		if (!trimmed) return;

		const folder: EpisodeFolder = {
			id: crypto.randomUUID(),
			name: trimmed,
			parentId: parentFolderId,
			isExpanded: true,
		};
		setEpisodeFolders((prev) => [folder, ...prev]);
		setSelectedFolderId(folder.id);
	};

	const handleToggleFolderExpanded = (folderId: string) => {
		setEpisodeFolders((prev) =>
			prev.map((f) => (f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f))
		);
	};

	return {
		handleSelectEpisode,
		handleOpenEpisode,
		handleSelectFolder,
		handleMoveEpisodeToFolder,
		handleMoveEpisode,
		handleMoveFolder,
		handleSortEpisodePanel,
		handleRenameEpisode,
		handleRenameFolder,
		handleDeleteFolder,
		handleDeleteEpisode,
		handleCreateFolder,
		handleToggleFolderExpanded,
	};
}