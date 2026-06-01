"use client";

import React from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AuthBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[AuthBoundary] session provider error:", error);
    // Report to Sentry when installed — dynamic import so the app works without it
    import("@sentry/nextjs")
      .then(({ captureException }) => captureException(error))
      .catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-medium text-[var(--foreground)]">
            Sign-in is temporarily unavailable.
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">
            Public pages still work. Authenticated features will return shortly.
          </p>
          <button
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
