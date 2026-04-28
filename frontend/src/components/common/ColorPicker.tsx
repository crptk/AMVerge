import React, { useState, useRef, useEffect } from "react";
import { HexColorPicker } from "react-colorful";
import "../../styles/colorPicker.css";

type ColorPickerProps = {
  color: string;
  onChange: (color: string) => void;
};

const PRESET_COLORS = [
  "#22c55e", "#3b82f6", "#ef4444", "#eab308", "#8b5cf6", "#f43f5e", 
  "#06b6d4", "#f97316", "#ffffff", "#bebebe", "#6366f1", "#a855f7"
];

export default function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="color-picker-container" ref={containerRef}>
      <div 
        className="color-preview-box" 
        style={{ backgroundColor: color }}
        onClick={() => setIsOpen(!isOpen)}
        title="Choose color"
      />
      
      {isOpen && (
        <div className="color-picker-popover">
          <div className="picker-section">
            <HexColorPicker color={color} onChange={onChange} />
          </div>

          <div className="presets-section">
            <label className="picker-label">Presets</label>
            <div className="color-presets-grid">
              {PRESET_COLORS.map((preset) => (
                <div
                  key={preset}
                  className={`color-preset-item ${color.toLowerCase() === preset.toLowerCase() ? "active" : ""}`}
                  style={{ backgroundColor: preset }}
                  onClick={() => onChange(preset)}
                  title={preset}
                />
              ))}
            </div>
          </div>
          
          <div className="manual-section">
            <div className="color-picker-manual">
              <span className="hex-prefix">#</span>
              <input
                type="text"
                className="hex-input"
                value={color.replace("#", "")}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[0-9a-fA-F]{0,6}$/.test(val)) {
                    onChange(`#${val}`);
                  }
                }}
                spellCheck={false}
                maxLength={6}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
