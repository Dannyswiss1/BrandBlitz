import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col">
      <header className="border-b border-[var(--border)] px-6 h-16 flex items-center">
        <Link
          href="/"
          className="font-extrabold text-xl text-[var(--primary)]"
          aria-label="BrandBlitz home"
        >
          BrandBlitz
        </Link>
      </header>

      <main
        role="main"
        className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center"
      >
        <p className="text-6xl font-extrabold text-[var(--primary)] mb-4" aria-hidden="true">
          404
        </p>
        <h1 className="text-2xl font-bold mb-3">This page doesn&apos;t exist</h1>
        <p className="text-[var(--muted-foreground)] mb-8 max-w-sm">
          This challenge doesn&apos;t exist — try a live one from the home page.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity min-h-[44px]"
          >
            Play a live challenge
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors min-h-[44px]"
          >
            View leaderboard
          </Link>
        </div>
      </main>
    </div>
  );
}
