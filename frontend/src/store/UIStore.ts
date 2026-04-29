import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UIState = {
  cols: number;
  gridPreview: boolean;
  sidebarEnabled: boolean;
  sidebarWidthPx: number;
  dividerOffsetPx: number;
};

export type UIStateStore = UIState & {
  setCols: (cols: number | ((prev: number) => number)) => void;
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
};

export const DEFAULT_UI_STATE: UIState = {
  cols: 6,
  gridPreview: false,
  sidebarEnabled: true,
  sidebarWidthPx: 280,
  dividerOffsetPx: 0,
};

export const useUIStateStore = create<UIStateStore>()(
  persist(
    (set) => ({
      ...DEFAULT_UI_STATE,

      setCols: (cols) =>
        set((state) => ({
          cols: typeof cols === "function" ? cols(state.cols) : cols,
        })),

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
    }),
    {
      name: "amverge.ui.v1",
      partialize: (state) => ({
        // only these states are tracked in localStorage
        sidebarWidthPx: state.sidebarWidthPx,
        cols: state.cols,
        gridPreview: state.gridPreview,
        sidebarEnabled: state.sidebarEnabled,
      }),
    }
  )
);