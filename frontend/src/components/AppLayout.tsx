import React from "react";
import Sidebar from "./sidebar/Sidebar";
import Navbar from "./Navbar";
import { useUIStateStore } from "../store/UIStore";

export interface AppLayoutProps {
  windowWrapperRef: React.RefObject<HTMLDivElement | null>;
  sidebarProps: React.ComponentProps<typeof Sidebar>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
  loadingOverlay?: React.ReactNode;
  userHasHEVC: boolean;
}

export default function AppLayout({
  windowWrapperRef,
  sidebarProps,
  onPointerDown,
  children,
  loadingOverlay,
  userHasHEVC
}: AppLayoutProps) {
  const sidebarWidthPx = useUIStateStore(s => s.sidebarWidthPx);
  const dividerOffsetPx = useUIStateStore(s => s.dividerOffsetPx);
  const sidebarEnabled = useUIStateStore(s => s.sidebarEnabled);
  const isDragging = useUIStateStore(s => s.isDragging);
  
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
          ["--amverge-sidebar-width" as any]: `${sidebarWidthPx}px`,
          ["--amverge-divider-offset" as any]: `${dividerOffsetPx}px`,
        }}
      >
        {sidebarEnabled && (
          <>
            <Sidebar {...sidebarProps} />
            <div
              className="divider sidebar-splitter"
              onPointerDown={onPointerDown}
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
          <Navbar userHasHEVC={userHasHEVC}/>
          {children}
        </div>
      </div>
    </main>
  );
}
