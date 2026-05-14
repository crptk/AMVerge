// Episode Panel modal renderer. Displays text input modals and confirmation modals.
import type React from "react";
import type { ConfirmModalState, TextModalState } from "../types";

type EpisodePanelModalsProps = {
  textModal: TextModalState | null;
  confirmModal: ConfirmModalState | null;
  textModalInputRef: React.RefObject<HTMLInputElement | null>;
  setTextModal: React.Dispatch<React.SetStateAction<TextModalState | null>>;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState | null>>;
};

export default function EpisodePanelModals({
  textModal,
  confirmModal,
  textModalInputRef,
  setTextModal,
  setConfirmModal,
}: EpisodePanelModalsProps) {
  return (
    <>
      {textModal && (
        <div className="episode-modal-overlay" onMouseDown={() => setTextModal(null)}>
          <div className="episode-modal" onMouseDown={(e) => e.stopPropagation()}>
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
        <div className="episode-modal-overlay" onMouseDown={() => setConfirmModal(null)}>
          <div className="episode-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="episode-modal-title">{confirmModal.title}</div>
            <div className="episode-modal-message">{confirmModal.message}</div>
            {confirmModal.note && (
              <div className="episode-modal-note">{confirmModal.note}</div>
            )}

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
                className={`episode-modal-btn primary${
                  confirmModal.confirmTone === "danger" ? " danger" : ""
                }`}
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
    </>
  );
}