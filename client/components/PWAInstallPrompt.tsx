import { useEffect } from "react";

export default function PWAInstallPrompt() {
  useEffect(() => {
    const preventAutomaticInstallPrompt = (event: Event) => event.preventDefault();
    window.addEventListener("beforeinstallprompt", preventAutomaticInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", preventAutomaticInstallPrompt);
  }, []);

  return null;
}
