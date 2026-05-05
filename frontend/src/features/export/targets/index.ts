import { afterEffectsTarget } from "./afterEffects";
import { capcutTarget } from "./capcut";
import { davinciResolveTarget } from "./davinciResolve";
import { premierProTarget } from "./premier_pro";
import type { EditorTarget, EditorTargetConfig } from "./types";

export type { EditorTarget, EditorTargetConfig } from "./types";

export const EDITOR_TARGETS: EditorTargetConfig[] = [
  premierProTarget,
  afterEffectsTarget,
  davinciResolveTarget,
  capcutTarget,
];

const TARGET_BY_ID = new Map<EditorTarget, EditorTargetConfig>(
  EDITOR_TARGETS.map((target) => [target.value, target])
);

export const editorLabel = (target: EditorTarget): string =>
  TARGET_BY_ID.get(target)?.label ?? "Premiere Pro";

export const supportsOriginalCut = (target: EditorTarget): boolean =>
  TARGET_BY_ID.get(target)?.supportsOriginalCut ?? true;
