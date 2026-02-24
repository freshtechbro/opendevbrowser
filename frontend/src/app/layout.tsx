import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { StickyCta } from "@/components/layout/sticky-cta";
import "@/styles/globals.css";

const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta"
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains"
});

const displayFont = localFont({
  src: [
    { path: "./fonts/satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/satoshi-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/satoshi-900.woff2", weight: "900", style: "normal" }
  ],
  variable: "--font-satoshi",
  display: "swap",
  fallback: ["General Sans", "system-ui", "sans-serif"]
});

const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

export const metadata: Metadata = {
  title: "OpenDevBrowser | Script-first browser automation for AI agents",
  description:
    "Script-first browser automation for AI agents with deterministic snapshot, refs, and actions across managed, extension, and CDP modes.",
  metadataBase,
  openGraph: {
    title: "OpenDevBrowser",
    description:
      "Deterministic browser automation for AI agents with snapshot to refs to actions and production-grade controls.",
    type: "website",
    images: [
      {
        url: "/brand/social-og.png",
        width: 1200,
        height: 630,
        alt: "OpenDevBrowser social preview"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    images: ["/brand/social-og.png"]
  },
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32x32.png", sizes: "32x32", type: "image/png" }
    ],
    shortcut: "/brand/favicon.ico"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div className="surface-bg" aria-hidden />
        <div className="surface-noise" aria-hidden />
        <div className="site-shell">
          <SiteHeader />
          <main id="main-content" className="page-main">
            {children}
          </main>
          <SiteFooter />
        </div>
        <StickyCta />
      </body>
    </html>
  );
}
