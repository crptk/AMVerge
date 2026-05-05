import { useState, useRef, useEffect, type ReactNode } from "react";
import { FaChevronDown } from "react-icons/fa";

export interface DropdownOption<T> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface DropdownProps<T> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}

export default function Dropdown<T extends string | number>({
  options,
  value,
  onChange,
  className = "",
  disabled = false,
}: DropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
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

  const toggleDropdown = () => {
    if (!disabled) setIsOpen(!isOpen);
  };

  const handleSelect = (val: T) => {
    onChange(val);
    setIsOpen(false);
  };

  const renderOptionContent = (option: DropdownOption<T>) => (
    <div className={`dropdown-item-content${option.description ? " has-description" : ""}`}>
      <div className="dropdown-item-main">
        {option.icon && <span className="dropdown-item-icon">{option.icon}</span>}
        <span className="dropdown-item-label">{option.label}</span>
      </div>
      {option.description && <span className="dropdown-item-description">{option.description}</span>}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`custom-dropdown ${className} ${isOpen ? "open" : ""} ${
        disabled ? "disabled" : ""
      }`}
    >
      <div className="dropdown-trigger" onClick={toggleDropdown}>
        {selectedOption ? (
          <div className={`dropdown-value${selectedOption.description ? " rich" : ""}`}>
            {renderOptionContent(selectedOption)}
          </div>
        ) : (
          <span className="dropdown-value">{String(value)}</span>
        )}
        <FaChevronDown className={`dropdown-icon ${isOpen ? "rotate" : ""}`} />
      </div>

      {isOpen && (
        <div className="dropdown-menu">
          {options.map((option) => (
            <div
              key={option.value}
              className={`dropdown-item ${
                option.value === value ? "active" : ""
              }`}
              onClick={() => handleSelect(option.value)}
            >
              {renderOptionContent(option)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
