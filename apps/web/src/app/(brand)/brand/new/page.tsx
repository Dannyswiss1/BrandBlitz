"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrandKitForm } from "@/components/brand/brand-kit-form";

export default function NewBrandPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/brand/new");
    }
  }, [status, router]);

  if (status === "loading" || !session) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-9 w-56 rounded bg-[var(--muted)]" />
          <div className="h-5 w-80 rounded bg-[var(--muted)]" />
          <div className="h-96 rounded-lg bg-[var(--muted)]" />
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">Create Brand Kit</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">
        Upload your brand assets and information to generate a challenge.
      </p>
      <BrandKitForm apiToken={session.apiToken} />
    </main>
  );
}
