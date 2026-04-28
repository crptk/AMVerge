import { useEffect } from "react";

export default function useHEVCSupport(userHasHEVC: React.MutableRefObject<boolean>) {
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

      userHasHEVC.current = candidates.some((mime) => {
        const result = videoEl.canPlayType(mime);
        return isTypeSupported(mime) || result === "probably" || result === "maybe";
      });
    } catch {
      userHasHEVC.current = false;
    }
  }, [userHasHEVC]);
}