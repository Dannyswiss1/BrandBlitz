"use client";

import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNetworkStatus } from "@/hooks/use-network-status";

interface OfflineBannerProps {
  blocking?: boolean;
  className?: string;
}

export function OfflineBanner({ blocking = false, className }: OfflineBannerProps) {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div
      className={cn(
        "z-50 w-full border-b border-amber-700 bg-amber-300 px-4 py-3 text-amber-950 shadow-sm",
        blocking ? "fixed left-0 top-0" : "sticky top-0",
        className,
      )}
      role="status"
      aria-live="assertive"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 text-sm font-semibold">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>You are offline. We will reconnect automatically when your connection returns.</span>
      </div>
    </div>
  );
}
