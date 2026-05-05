import { convertFileSrc } from "@tauri-apps/api/core";
import type { ComponentType, ReactNode } from "react";
import {
  IconAfterEffects,
  IconCapCut,
  IconCustom,
  IconDNxHR,
  IconH264,
  IconH265,
  IconPremiere,
  IconProRes,
  IconRemux,
  IconResolve,
  IconUncompressed,
  IconVideo,
  type ProfileIconProps,
} from "../../components/icons/ProfileIcons";
import type { ExportProfile, ExportProfileIcon } from "./profiles";

type BuiltInProfileIcon = Exclude<ExportProfileIcon, "custom">;

const PROFILE_ICON_COMPONENTS: Record<BuiltInProfileIcon, ComponentType<ProfileIconProps>> = {
  video: IconVideo,
  remux: IconRemux,
  h264: IconH264,
  h265: IconH265,
  prores: IconProRes,
  dnxhr: IconDNxHR,
  uncompressed: IconUncompressed,
  premiere: IconPremiere,
  after_effects: IconAfterEffects,
  resolve: IconResolve,
  capcut: IconCapCut,
};

export function resolveStoredAssetPath(path: string): string {
  const [cleanPath, query] = path.split("?");
  const src = convertFileSrc(cleanPath);
  return query ? `${src}?${query}` : src;
}

export function renderProfileIcon(
  profile: Pick<ExportProfile, "icon" | "customIconPath">,
  alt: string = "Profile icon"
): ReactNode {
  if (profile.icon === "custom") {
    if (profile.customIconPath) {
      return <img className="profile-custom-icon" src={resolveStoredAssetPath(profile.customIconPath)} alt={alt} />;
    }
    return <IconCustom />;
  }

  const Icon = PROFILE_ICON_COMPONENTS[profile.icon as BuiltInProfileIcon] ?? IconVideo;
  return <Icon />;
}
