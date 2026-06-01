import Link from "next/link";

export default function BrandNotFound() {
  return (
    <main
      role="main"
      className="flex flex-col items-center justify-center px-6 py-20 text-center min-h-[60vh]"
    >
      <p className="text-6xl font-extrabold text-[var(--primary)] mb-4" aria-hidden="true">
        404
      </p>
      <h1 className="text-2xl font-bold mb-3">This brand doesn&apos;t exist</h1>
      <p className="text-[var(--muted-foreground)] mb-8 max-w-sm">
        The brand you&apos;re looking for doesn&apos;t exist — create your own and launch a
        challenge.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/brand/new"
          className="inline-flex items-center justify-center rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity min-h-[44px]"
        >
          Create a brand
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors min-h-[44px]"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
