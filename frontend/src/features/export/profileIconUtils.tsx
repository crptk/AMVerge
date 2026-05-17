import { convertFileSrc } from "@tauri-apps/api/core";
import type { ComponentType, ReactNode } from "react";
import {
  IconCustom,
  IconH264,
  IconH265,
  IconProRes,
  IconRemux,
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
