import React from "react";
import { FaDownload } from "react-icons/fa";

type DownloadButtonProps = {
  onClick: (e: React.MouseEvent) => void;
  loading?: boolean;
};

/**
 * A small download button designed to sit on a clip tile.
 * Animated on hover for a premium feel.
 */
export const DownloadButton: React.FC<DownloadButtonProps> = ({ onClick, loading }) => {
  return (
    <button
      className={`clip-download-btn ${loading ? "loading" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title="Download this clip"
      disabled={loading}
    >
      <FaDownload />
    </button>
  );
};
