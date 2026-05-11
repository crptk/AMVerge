import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

export type StartupNotification = {
  id: string;
  targetVersion?: string | null;
  title: string;
  bodyMarkdown: string;
  bannerImageUrl?: string | null;
  createdAt?: string | null;
};

type StartupNotificationModalProps = {
  notification: StartupNotification;
  onClose: (doNotShowAgain: boolean) => void;
};

function buildBannerCandidates(rawUrl?: string | null): string[] {
  if (!rawUrl) {
    return [];
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = [trimmed];

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split("/").filter(Boolean);

    if (host === "imgur.com" || host === "www.imgur.com" || host === "m.imgur.com") {
      const root = pathParts[0] ?? "";
      if (root === "a" || root === "gallery") {
        return [...new Set(candidates)];
      }

      let imageId = root.split(".")[0];

      if (imageId) {
        const directBase = `https://i.imgur.com/${imageId}`;
        candidates.push(
          `${directBase}.jpg`,
          `${directBase}.jpeg`,
          `${directBase}.png`,
          `${directBase}.webp`
        );
      }
    }

    if (host === "i.imgur.com" && pathParts.length > 0) {
      const imageId = pathParts[pathParts.length - 1].split(".")[0];
      if (imageId) {
        const directBase = `https://i.imgur.com/${imageId}`;
        candidates.push(
          `${directBase}.jpg`,
          `${directBase}.jpeg`,
          `${directBase}.png`,
          `${directBase}.webp`
        );
      }
    }
  } catch {
    return [...new Set(candidates)];
  }

  return [...new Set(candidates)];
}

function isImgurPageUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    return host === "imgur.com" || host === "www.imgur.com" || host === "m.imgur.com";
  } catch {
    return false;
  }
}

async function resolveImgurOEmbedCandidates(rawUrl: string): Promise<string[]> {
  const endpoint = `https://api.imgur.com/oembed.json?url=${encodeURIComponent(rawUrl)}`;
  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    url?: unknown;
    thumbnail_url?: unknown;
  };

  const candidates: string[] = [];
  if (typeof payload.url === "string" && payload.url.trim()) {
    candidates.push(payload.url.trim());
  }
  if (typeof payload.thumbnail_url === "string" && payload.thumbnail_url.trim()) {
    candidates.push(payload.thumbnail_url.trim());
  }

  return [...new Set(candidates)];
}

export default function StartupNotificationModal({
  notification,
  onClose,
}: StartupNotificationModalProps) {
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [bannerCandidates, setBannerCandidates] = useState<string[]>([]);
  const [bannerIndex, setBannerIndex] = useState(0);

  useEffect(() => {
    let canceled = false;

    const loadCandidates = async () => {
      const baseCandidates = buildBannerCandidates(notification.bannerImageUrl);
      let finalCandidates = baseCandidates;

      if (notification.bannerImageUrl && isImgurPageUrl(notification.bannerImageUrl)) {
        try {
          const oembedCandidates = await resolveImgurOEmbedCandidates(notification.bannerImageUrl);
          finalCandidates = [...new Set([...oembedCandidates, ...baseCandidates])];
        } catch {
          finalCandidates = baseCandidates;
        }
      }

      if (!canceled) {
        setBannerCandidates(finalCandidates);
      }
    };

    setBannerIndex(0);
    setBannerCandidates([]);
    void loadCandidates();

    return () => {
      canceled = true;
    };
  }, [notification.id, notification.bannerImageUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose(doNotShowAgain);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [doNotShowAgain, onClose]);

  const bannerSrc = bannerCandidates[bannerIndex];

  return (
    <div className="startup-notification-overlay" role="dialog" aria-modal="true" aria-labelledby="startup-notification-title">
      <div className="startup-notification-modal">
        {bannerSrc ? (
          <img
            className="startup-notification-banner"
            src={bannerSrc}
            alt="Notification banner"
            loading="eager"
            onError={() => {
              setBannerIndex((current) =>
                current + 1 < bannerCandidates.length ? current + 1 : bannerCandidates.length
              );
            }}
          />
        ) : null}

        <h2 id="startup-notification-title" className="startup-notification-title">
          {notification.title}
        </h2>
        
        <div className="startup-notification-body">
          <ReactMarkdown>{notification.bodyMarkdown}</ReactMarkdown>
        </div>

        <div className="startup-notification-actions">
          <label className="startup-notification-checkbox">
            <input
              type="checkbox"
              checked={doNotShowAgain}
              onChange={(event) => setDoNotShowAgain(event.target.checked)}
            />
            <span>Do not show again</span>
          </label>

          <button
            type="button"
            className="startup-notification-close"
            onClick={() => onClose(doNotShowAgain)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
