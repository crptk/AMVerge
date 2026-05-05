export type EditorTarget = "premier_pro" | "after_effects" | "davinci_resolve" | "capcut";

export type EditorTargetConfig = {
  value: EditorTarget;
  label: string;
  className: string;
  icon: string;
  supportsOriginalCut: boolean;
};
