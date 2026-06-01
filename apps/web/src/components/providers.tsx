"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

const SessionProvider = dynamic(() => import("next-auth/react").then((m) => m.SessionProvider));

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster closeButton position="top-right" richColors />
    </SessionProvider>
  );
}
