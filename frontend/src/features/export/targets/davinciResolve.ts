import davinciIcon from "../../../assets/editor-icons/davinciresolve.svg";
import { EditorTargetConfig } from "./types";

export const davinciResolveTarget: EditorTargetConfig = {
  value: "davinci_resolve",
  label: "DaVinci Resolve",
  className: "davinci",
  icon: davinciIcon,
  supportsOriginalCut: true,
};
