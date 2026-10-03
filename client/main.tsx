import "./global.css";
import "./lib/i18n";

import { createRoot } from "react-dom/client";
import App from "./App";
import { suppressResizeObserverErrors } from "./lib/suppressWarnings";
import { installAuthFetchInterceptor } from "./lib/api";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element not found");
}

// Create root only once and handle potential re-renders
let root: ReturnType<typeof createRoot>;

// Suppress noisy ResizeObserver logs early
suppressResizeObserverErrors();

function render() {
  if (!root) {
    root = createRoot(container);
  }
  root.render(<App />);
}

// Install global auth/refresh fetch interceptor, then render
installAuthFetchInterceptor();

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch((error) => console.error("Service worker registration failed:", error));
    });
  } else {
    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => {
            const workers = [
              registration.active,
              registration.waiting,
              registration.installing,
            ].filter(Boolean);
            return workers.some((worker) => {
              const script = new URL(worker!.scriptURL);
              return script.origin === window.location.origin && script.pathname === "/sw.js";
            });
          })
          .map((registration) => registration.unregister()),
      );
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith("stockmind-"))
          .map((name) => caches.delete(name)),
      );
    })();
  }
}

// Initial render
render();

// Handle hot module replacement in development
if (import.meta.hot) {
  import.meta.hot.accept("./App", () => {
    render();
  });
}
