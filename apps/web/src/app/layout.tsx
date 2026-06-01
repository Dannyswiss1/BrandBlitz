import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { getCspNonce } from "@/lib/csp";
import { FingerprintProvider } from "@/components/providers/fingerprint-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BrandBlitz — Stellar Edition",
  description:
    "Brands deposit USDC on Stellar. Users compete in 45-second brand challenges. Top performers earn USDC instantly.",
  openGraph: {
    title: "BrandBlitz",
    description: "Earn USDC by mastering brand challenges",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = getCspNonce();

  return (
    <html lang="en" className={inter.className}>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" nonce={nonce}>
          {`
            (function () {
              try {
                var key = "theme";
                var mode = localStorage.getItem(key);
                if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "system";
                var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
                var isDark = mode === "dark" || (mode === "system" && prefersDark);
                var html = document.documentElement;
                if (isDark) html.classList.add("dark"); else html.classList.remove("dark");
                html.dataset.theme = mode;
              } catch (e) {}
            })();
          `}
        </Script>
      </head>
      <body className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)] antialiased">
        <FingerprintProvider>
          <AuthBoundary>
            <SessionProvider>
              {children}
              <Toaster closeButton position="top-right" richColors />
            </SessionProvider>
          </AuthBoundary>
        </FingerprintProvider>
      </body>
    </html>
  );
}
