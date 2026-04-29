import { EpisodeEntry, EpisodeFolder } from "../types/domain";
import { startTransition }  from "react";
import { ClipItem } from "../types/domain"

type episodePanelProps = {
  episodes: EpisodeEntry[];
  setEpisodes: React.Dispatch<React.SetStateAction<EpisodeEntry[]>>;
  selectedEpisodeId: string | null;
  setSelectedEpisodeId: React.Dispatch<React.SetStateAction<string | null>>;
  episodeFolders: EpisodeFolder[];
  setEpisodeFolders: React.Dispatch<React.SetStateAction<EpisodeFolder[]>>;
  openedEpisodeId: string | null;
  setOpenedEpisodeId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedFolderId: string | null;
  setSelectedFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>;
  setFocusedClip: React.Dispatch<React.SetStateAction<string | null>>;
  setImportedVideoPath: React.Dispatch<React.SetStateAction<string | null>>;
  setImportToken: React.Dispatch<React.SetStateAction<string>>;
  episodesPath: string | null;
};

export default function useEpisodePanelState(props: episodePanelProps) {

	// Handlers
	const handleSelectEpisode = (episodeId: string) => {
		props.setSelectedEpisodeId(episodeId);
		props.setSelectedFolderId(null);
	};

	const handleOpenEpisode = (episodeId: string) => {
		const selectedEpisode = props.episodes.find((e) => e.id === episodeId);
		if (!selectedEpisode) return;


		props.setSelectedClips(new Set());
		props.setFocusedClip(null);
		props.setSelectedEpisodeId(episodeId);
		props.setOpenedEpisodeId(episodeId);
		props.setSelectedFolderId(null);
		props.setImportedVideoPath(selectedEpisode.videoPath);
		props.setImportToken(Date.now().toString());

		startTransition(() => {
			props.setClips(selectedEpisode.clips);
		});
		console.log(selectedEpisode.clips);
	};

	const handleSelectFolder = (folderId: string | null) => {
		props.setSelectedFolderId(folderId);
		props.setSelectedEpisodeId(null);
	};

	const handleMoveEpisodeToFolder = (episodeId: string, folderId: string | null) => {
		props.setEpisodes((prev) =>
			prev.map((e) => (e.id === episodeId ? { ...e, folderId } : e))
		);
	};

	const handleMoveEpisode = (
		episodeId: string,
		folderId: string | null,
		beforeEpisodeId?: string
	) => {
		props.setEpisodes((prev) => {
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
		props.setEpisodeFolders((prev) => {
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

		const folders = props.episodeFolders;
		const episodesSnapshot = props.episodes;

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
		props.setEpisodeFolders(sortedFolders);

		props.setEpisodes(() => {
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
		props.setEpisodes((prev) => prev.map((e) => (e.id === episodeId ? { ...e, displayName: trimmed } : e)));
	};

	const handleRenameFolder = (folderId: string, newName: string) => {
		const trimmed = (newName ?? "").trim();
		if (!trimmed) return;
		props.setEpisodeFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)));
	};

	const handleDeleteFolder = (folderId: string) => {
		props.setEpisodeFolders((prev) =>
			prev
				.filter((f) => f.id !== folderId)
				.map((f) => (f.parentId === folderId ? { ...f, parentId: null } : f))
		);
		props.setEpisodes((prev) => prev.map((e) => (e.folderId === folderId ? { ...e, folderId: null } : e)));
		if (props.selectedFolderId === folderId) props.setSelectedFolderId(null);
	};

	const handleDeleteEpisode = (episodeId: string) => {
		props.setEpisodes((prev) => prev.filter((e) => e.id !== episodeId));
		if (props.selectedEpisodeId === episodeId) props.setSelectedEpisodeId(null);
		if (props.openedEpisodeId === episodeId) props.setOpenedEpisodeId(null);
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
		props.setEpisodeFolders((prev) => [folder, ...prev]);
		props.setSelectedFolderId(folder.id);
	};

	const handleToggleFolderExpanded = (folderId: string) => {
		props.setEpisodeFolders((prev) =>
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