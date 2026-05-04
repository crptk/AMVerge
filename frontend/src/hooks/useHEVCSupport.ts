import { useEffect } from "react";
import { useAppStateStore } from "../stores/appStore";

export default function useHEVCSupport() {
  const setUserHasHEVC = useAppStateStore((state) => state.setUserHasHEVC);

  useEffect(() => {
    try {
      const candidates = [
        'video/mp4; codecs="hvc1"',
        'video/mp4; codecs="hev1"',
        'video/mp4; codecs="hvc1.1.6.L93.B0"',
        'video/mp4; codecs="hev1.1.6.L93.B0"',
      ];

      const mediaSourceSupported = typeof (window as any).MediaSource !== "undefined";
      const isTypeSupported = mediaSourceSupported
        ? (mime: string) => (window as any).MediaSource.isTypeSupported(mime)
        : () => false;

      const videoEl = document.createElement("video");

      const hasHEVC = candidates.some((mime) => {
        const result = videoEl.canPlayType(mime);
        return isTypeSupported(mime) || result === "probably";
      });
      setUserHasHEVC(hasHEVC);
    } catch {
      setUserHasHEVC(false);
    }
  }, [setUserHasHEVC]);
}