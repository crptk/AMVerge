import premiereIcon from "../../../assets/editor-icons/adobepremierepro.svg";
import { EditorTargetConfig } from "./types";

export const premierProTarget: EditorTargetConfig = {
  value: "premier_pro",
  label: "Premiere Pro",
  className: "premier_pro",
  icon: premiereIcon,
  supportsOriginalCut: true,
};
