import React from "react";
import Sidebar from "./sidebar/Sidebar";
import Navbar from "./Navbar";

export interface AppLayoutProps {
  windowWrapperRef: React.RefObject<HTMLDivElement | null>;
  sidebarEnabled: boolean;
  navbarProps: React.ComponentProps<typeof Navbar>;
  dividerProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    dividerOffsetPx: number;
    sidebarWidthPx: number;
  };
  children: React.ReactNode;
  loadingOverlay?: React.ReactNode;
  isDragging: boolean;
}

export default function AppLayout({
  windowWrapperRef,
  sidebarEnabled,
  navbarProps,
  dividerProps,
  children,
  loadingOverlay,
  isDragging,
}: AppLayoutProps) {
  return (
    <main className="app-root">
      {loadingOverlay}
      {isDragging && (
        <div className="dragging-overlay">
          <h1>Drag file(s) here.</h1>
        </div>
      )}
      <div
        className="window-wrapper"
        ref={windowWrapperRef}
        style={{
          ["--amverge-sidebar-width" as any]: `${dividerProps.sidebarWidthPx}px`,
          ["--amverge-divider-offset" as any]: `${dividerProps.dividerOffsetPx}px`,
        }}
      >
        {sidebarEnabled && (
          <>
            <Sidebar />
            <div
              className="divider sidebar-splitter"
              onPointerDown={dividerProps.onPointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              tabIndex={-1}
            >
              <span className="subdivider" />
              <span className="subdivider" />
            </div>
          </>
        )}
        <div className="content-wrapper">
          <Navbar {...navbarProps} />
          {children}
        </div>
      </div>
    </main>
  );
}
