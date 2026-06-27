"use client";

import * as React from "react";

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = React.useState(true);

  React.useEffect(() => {
    const updateStatus = () => setIsOnline(navigator.onLine);
    updateStatus();

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  React.useEffect(() => {
    if (isOnline || typeof fetch !== "function") return;

    const intervalId = window.setInterval(() => {
      void fetch("/", { method: "HEAD", cache: "no-store" })
        .then(() => setIsOnline(true))
        .catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [isOnline]);

  return { isOnline };
}
