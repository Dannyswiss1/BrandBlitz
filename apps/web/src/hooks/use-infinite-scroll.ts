"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseInfiniteScrollOptions {
  /** Whether there are more pages to load */
  hasNextPage: boolean;
  /** Whether a fetch is currently in-flight */
  isLoading: boolean;
  /** Called when the sentinel enters the viewport */
  onLoadMore: () => void;
  /** Root margin for the IntersectionObserver (default "200px") */
  rootMargin?: string;
}

export function useInfiniteScroll({
  hasNextPage,
  isLoading,
  onLoadMore,
  rootMargin = "200px",
}: UseInfiniteScrollOptions): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry?.isIntersecting && hasNextPage && !isLoading) {
        onLoadMore();
      }
    },
    [hasNextPage, isLoading, onLoadMore]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin,
      threshold: 0,
    });

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [handleIntersect, rootMargin]);

  return sentinelRef;
}
