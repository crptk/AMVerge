import afterEffectsIcon from "../../../assets/editor-icons/adobeaftereffects.svg";
import { EditorTargetConfig } from "./types";

export const afterEffectsTarget: EditorTargetConfig = {
  value: "after_effects",
  label: "After Effects",
  className: "after-effects",
  icon: afterEffectsIcon,
  supportsOriginalCut: true,
};
