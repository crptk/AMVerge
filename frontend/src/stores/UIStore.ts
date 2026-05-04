import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Page } from "../components/sidebar/types";

export type UIState = {
    cols: number;
    gridPreview: boolean;
    sidebarEnabled: boolean;
    sidebarWidthPx: number;
    dividerOffsetPx: number;
    isDragging: boolean;
    activePage: Page;
    activeMode: "selector" | "editor";
};

export type UIStateStore = UIState & {
    setCols: (cols: number | ((prev: number) => number)) => void;
    incrementCols: () => void;
    decrementCols: () => void;
    setGridPreview: (
        previewEnabled: boolean | ((prev: boolean) => boolean)
    ) => void;
    setSidebarEnabled: (
        sideBarEnabled: boolean | ((prev: boolean) => boolean)
    ) => void;
    setSidebarWidthPx: (sideBarWidthPx: number) => void;
    setDividerOffsetPx: (
        dividerOffsetPx: number | ((prev: number) => number)
    ) => void;
    setIsDragging: (isDragging: boolean) => void;
    setActivePage: (activePage: Page | ((prev: Page) => Page)) => void;
    setActiveMode: (mode: "selector" | "editor" | ((prev: "selector" | "editor") => "selector" | "editor")) => void;
};

export const DEFAULT_UI_STATE: UIState = {
    cols: 6,
    gridPreview: false,
    sidebarEnabled: true,
    sidebarWidthPx: 280,
    dividerOffsetPx: 0,
    isDragging: false,
    activePage: "home",
    activeMode: "selector",
};

export const useUIStateStore = create<UIStateStore>()(
    persist(
        (set) => ({
            ...DEFAULT_UI_STATE,

            setCols: (cols) =>
                set((state) => ({
                    cols: typeof cols === "function" ? cols(state.cols) : cols,
                })),

            incrementCols: () =>
                set((state) => ({ cols: Math.min(12, state.cols + 1) })),

            decrementCols: () =>
                set((state) => ({ cols: Math.max(1, state.cols - 1) })),

            setGridPreview: (previewEnabled) =>
                set((state) => ({
                    gridPreview:
                        typeof previewEnabled === "function"
                            ? previewEnabled(state.gridPreview)
                            : previewEnabled,
                })),
            setSidebarEnabled: (sidebarEnabled) =>
                set((state) => ({
                    sidebarEnabled:
                        typeof sidebarEnabled === "function"
                            ? sidebarEnabled(state.sidebarEnabled)
                            : sidebarEnabled,
                })),
            setSidebarWidthPx: (sidebarWidthPx) => set({ sidebarWidthPx }),
            setDividerOffsetPx: (dividerOffsetPx) =>
                set((state) => ({
                    dividerOffsetPx:
                        typeof dividerOffsetPx === "function"
                            ? dividerOffsetPx(state.dividerOffsetPx)
                            : dividerOffsetPx,
                })),
            setIsDragging: (isDragging) => set({ isDragging }),
            setActivePage: (activePage) =>
                set((state) => ({
                    activePage: typeof activePage === "function" ? activePage(state.activePage) : activePage,
                })),
            setActiveMode: (mode) =>
                set((state) => ({
                    activeMode: typeof mode === "function" ? mode(state.activeMode) : mode,
                })),
        }),
        {
            name: "amverge.ui.v1",
            partialize: (state) => ({
                // only these states are tracked in localStorage
                sidebarWidthPx: state.sidebarWidthPx,
                cols: state.cols,
                gridPreview: state.gridPreview,
                sidebarEnabled: state.sidebarEnabled,
                activeMode: state.activeMode,
            }),
        }
    )
);