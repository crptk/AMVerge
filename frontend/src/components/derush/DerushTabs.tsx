import { useMemo, useRef, useState } from "react";
import type { DerushCategory } from "../../types/domain";

type DerushTabsProps = {
  scope: "episode" | "folder";
  canUseFolderScope: boolean;
  totalClipCount: number;
  categories: DerushCategory[];
  activeCategoryId: string;
  clipCategoryMap: Record<string, string[]>;
  clips: { id: string }[];
  syncing: boolean;
  onScopeChange: (scope: "episode" | "folder") => void;
  onSelectCategory: (categoryId: string) => void;
  onCreateCategory: (name: string, color: string) => Promise<void> | void;
  onUpdateCategory: (categoryId: string, name: string, color: string) => Promise<void> | void;
  onDeleteCategory: (categoryId: string) => Promise<void> | void;
};

export default function DerushTabs(props: DerushTabsProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCategoryColor, setNewCategoryColor] = useState("#8DF7B1");
  const [editingCategory, setEditingCategory] = useState<DerushCategory | null>(null);
  const [editColor, setEditColor] = useState("#8DF7B1");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);

  const countByCategory = useMemo(() => {
    const byCategory = new Map<string, number>();
    const visibleIds = new Set(props.clips.map((clip) => clip.id));

    for (const [clipId, categories] of Object.entries(props.clipCategoryMap)) {
      if (!visibleIds.has(clipId)) continue;
      for (const categoryId of categories) {
        byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + 1);
      }
    }

    return byCategory;
  }, [props.clipCategoryMap, props.clips]);

  const confirmCreateCategory = async () => {
    const value = (nameInputRef.current?.value ?? "").trim();
    if (!value) return;
    await props.onCreateCategory(value, newCategoryColor);
    setShowCreateModal(false);
  };

  const openEditModal = (category: DerushCategory) => {
    setEditingCategory(category);
    setEditColor(category.color || "#8DF7B1");
    requestAnimationFrame(() => {
      editNameInputRef.current?.focus();
      editNameInputRef.current?.select();
    });
  };

  const confirmUpdateCategory = async () => {
    if (!editingCategory) return;
    const value = (editNameInputRef.current?.value ?? "").trim();
    if (!value) return;
    await props.onUpdateCategory(editingCategory.id, value, editColor);
    setEditingCategory(null);
  };

  const confirmDeleteCategory = async () => {
    if (!editingCategory) return;
    await props.onDeleteCategory(editingCategory.id);
    setEditingCategory(null);
  };

  return (
    <section className="derush-tabs-shell">
      {props.canUseFolderScope && (
        <div className="derush-scope-switch">
          <button
            type="button"
            className={`derush-scope-btn ${props.scope === "episode" ? "active" : ""}`}
            onClick={() => props.onScopeChange("episode")}
          >
            Rush
          </button>
          <button
            type="button"
            className={`derush-scope-btn ${props.scope === "folder" ? "active" : ""}`}
            onClick={() => props.onScopeChange("folder")}
          >
            Dossier
          </button>
        </div>
      )}

      <div className="derush-tabs-row">
        <button
          type="button"
          className={`derush-tab ${props.activeCategoryId === "all" ? "active" : ""}`}
          onClick={() => props.onSelectCategory("all")}
        >
          <span>All</span>
          <small>{props.totalClipCount}</small>
        </button>

        {props.categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`derush-tab ${props.activeCategoryId === category.id ? "active" : ""}`}
            onClick={() => props.onSelectCategory(category.id)}
            onDoubleClick={() => {
              openEditModal(category);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              openEditModal(category);
            }}
            title={category.name}
          >
            <span
              className="derush-tab-dot"
              style={{ background: category.color }}
              aria-hidden="true"
            />
            <span>{category.name}</span>
            <small>
              {props.scope === "folder"
                ? (category.projectClipCount ?? countByCategory.get(category.id) ?? 0)
                : (category.episodeClipCount ?? countByCategory.get(category.id) ?? 0)}
            </small>
          </button>
        ))}

        <button
          type="button"
          className="derush-tab add"
          onClick={() => {
            setShowCreateModal(true);
            setNewCategoryColor("#8DF7B1");
            requestAnimationFrame(() => {
              nameInputRef.current?.focus();
              nameInputRef.current?.select();
            });
          }}
          title="Create category"
        >
          + Category
        </button>
      </div>

      {props.syncing && <div className="derush-syncing-inline">Sync</div>}

      {showCreateModal && (
        <div
          className="episode-modal-overlay"
          onMouseDown={() => setShowCreateModal(false)}
        >
          <div
            className="episode-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="episode-modal-title">New derush category</div>
            <input
              ref={nameInputRef}
              className="episode-modal-input"
              placeholder="Category name..."
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowCreateModal(false);
                if (e.key === "Enter") void confirmCreateCategory();
              }}
            />
            <div className="derush-color-row">
              <span>Color</span>
              <input
                type="color"
                className="derush-color-input"
                value={newCategoryColor}
                onChange={(e) => setNewCategoryColor(e.target.value)}
              />
            </div>
            <div className="episode-modal-actions">
              <button
                type="button"
                className="episode-modal-btn"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="episode-modal-btn primary"
                onClick={() => void confirmCreateCategory()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCategory && (
        <div
          className="episode-modal-overlay"
          onMouseDown={() => setEditingCategory(null)}
        >
          <div
            className="episode-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="episode-modal-title">Edit category</div>
            <input
              ref={editNameInputRef}
              className="episode-modal-input"
              defaultValue={editingCategory.name}
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingCategory(null);
                if (e.key === "Enter") void confirmUpdateCategory();
              }}
            />
            <div className="derush-color-row">
              <span>Color</span>
              <input
                type="color"
                className="derush-color-input"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
              />
            </div>
            <div className="episode-modal-actions">
              <button
                type="button"
                className="episode-modal-btn danger"
                onClick={() => void confirmDeleteCategory()}
              >
                Delete
              </button>
              <button
                type="button"
                className="episode-modal-btn"
                onClick={() => setEditingCategory(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="episode-modal-btn primary"
                onClick={() => void confirmUpdateCategory()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
