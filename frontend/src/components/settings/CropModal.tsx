import React, { useState, useRef, useEffect } from "react";
import ReactCrop, { centerCrop, makeAspectCrop, Crop, PixelCrop } from "react-image-crop";
import { FaUndo, FaRedo, FaArrowsAltH, FaArrowsAltV, FaExpand, FaSyncAlt } from "react-icons/fa";
import "react-image-crop/dist/ReactCrop.css";

type CropModalProps = {
  image: string;
  onClose: () => void;
  onCropComplete: (data: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flip: { horizontal: boolean; vertical: boolean };
  }) => void;
};

const ASPECT_RATIOS = [
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "1:1", value: 1 },
  { label: "Free", value: undefined },
];

export default function CropModal({ image, onClose, onCropComplete }: CropModalProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState<number | undefined>(16 / 9);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });
  const [customRes, setCustomRes] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { width, height } = e.currentTarget;
    const initialCrop = centerCrop(
      makeAspectCrop({ unit: "%", width: 90 }, aspect || 1, width, height),
      width,
      height
    );
    setCrop(initialCrop);
  }

  useEffect(() => {
    if (imgRef.current && aspect !== undefined) {
      const { width, height } = imgRef.current;
      const newCrop = centerCrop(
        makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height),
        width,
        height
      );
      setCrop(newCrop);
    }
  }, [aspect]);

  useEffect(() => {
    if (completedCrop) {
      setCustomRes({
        width: Math.round(completedCrop.width),
        height: Math.round(completedCrop.height),
      });
    }
  }, [completedCrop]);

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setAspect(16 / 9);
    setFlip({ horizontal: false, vertical: false });
    if (imgRef.current) {
      const { width, height } = imgRef.current;
      setCrop(centerCrop(makeAspectCrop({ unit: "%", width: 90 }, 16 / 9, width, height), width, height));
    }
  };

  const handleCustomResChange = (type: "width" | "height", val: string) => {
    const num = parseInt(val) || 0;
    const next = { ...customRes, [type]: num };
    setCustomRes(next);
    if (next.width > 0 && next.height > 0) {
      setAspect(next.width / next.height);
    }
  };

  const handleSave = async () => {
    if (!completedCrop || !imgRef.current || loading) return;

    setLoading(true);
    const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
    const scaleY = imgRef.current.naturalHeight / imgRef.current.height;

    onCropComplete({
      x: completedCrop.x * scaleX,
      y: completedCrop.y * scaleY,
      width: completedCrop.width * scaleX,
      height: completedCrop.height * scaleY,
      rotation,
      flip,
    });
  };

  return (
    <div className="crop-modal-overlay">
      <div className="crop-modal">
        <div className="crop-modal-header">
          <div className="header-left">
            <FaExpand className="header-icon" />
            <h3>Crop & Transform</h3>
          </div>
          <button className="reset-btn" onClick={handleReset} title="Reset all changes">
            <FaSyncAlt /> Reset
          </button>
        </div>

        <div className="crop-container-wrapper">
          <div
            className="crop-container"
            style={{
              transform: `rotate(${rotation}deg) scaleX(${flip.horizontal ? -1 : 1}) scaleY(${flip.vertical ? -1 : 1})`,
              transition: "transform 0.3s ease"
            }}
          >
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={aspect}
              className="custom-react-crop"
            >
              <img
                ref={imgRef}
                alt="Crop me"
                src={image}
                onLoad={onImageLoad}
                crossOrigin="anonymous"
                style={{
                  maxWidth: "100%",
                  maxHeight: "400px",
                  transform: `scale(${zoom})`,
                  transition: "transform 0.2s ease"
                }}
              />
            </ReactCrop>
          </div>
        </div>

        <div className="crop-toolbar">
          <div className="toolbar-section">
            <label>Aspect Ratio</label>
            <div className="aspect-buttons">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio.label}
                  className={`toolbar-btn ${aspect === ratio.value ? "active" : ""}`}
                  onClick={() => setAspect(ratio.value)}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
            <div className="custom-res-row">
              <div className="res-input-group">
                <span>W</span>
                <input
                  type="number"
                  value={customRes.width}
                  onChange={(e) => handleCustomResChange("width", e.target.value)}
                  placeholder="Width"
                />
              </div>
              <div className="res-input-group">
                <span>H</span>
                <input
                  type="number"
                  value={customRes.height}
                  onChange={(e) => handleCustomResChange("height", e.target.value)}
                  placeholder="Height"
                />
              </div>
            </div>
          </div>

          <div className="toolbar-section">
            <label>Rotate & Flip</label>
            <div className="transform-buttons">
              <button className="toolbar-btn" onClick={() => setRotation((r) => r - 90)} title="Rotate Left">
                <FaUndo />
              </button>
              <button className="toolbar-btn" onClick={() => setRotation((r) => r + 90)} title="Rotate Right">
                <FaRedo />
              </button>
              <button
                className={`toolbar-btn ${flip.horizontal ? "active" : ""}`}
                onClick={() => setFlip((f) => ({ ...f, horizontal: !f.horizontal }))}
                title="Flip Horizontal"
              >
                <FaArrowsAltH />
              </button>
              <button
                className={`toolbar-btn ${flip.vertical ? "active" : ""}`}
                onClick={() => setFlip((f) => ({ ...f, vertical: !f.vertical }))}
                title="Flip Vertical"
              >
                <FaArrowsAltV />
              </button>
            </div>
          </div>

          <div className="toolbar-section zoom-section">
            <label>Zoom ({Math.round(zoom * 100)}%)</label>
            <input
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.1}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="crop-modal-footer">
          <p className="crop-hint">Drag corners to resize freely</p>
          <div className="footer-actions">
            <button className="footer-btn cancel" onClick={onClose} disabled={loading}>Cancel</button>
            <button className="footer-btn primary" onClick={handleSave} disabled={loading}>
              {loading ? <div className="spinner"></div> : "Save & Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}