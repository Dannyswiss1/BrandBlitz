"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Toaster, toast } from "sonner";

const SessionProvider = dynamic(() => import("next-auth/react").then((m) => m.SessionProvider));

// Capture unhandled promise rejections so they surface as toasts rather than
// being silently swallowed in production (issue #570).
function UnhandledRejectionHandler() {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "An unexpected error occurred.";
      console.error("[unhandledrejection]", reason);
      toast.error(message);
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UnhandledRejectionHandler />
      {children}
      <Toaster closeButton position="top-right" richColors />
    </SessionProvider>
  );
}
