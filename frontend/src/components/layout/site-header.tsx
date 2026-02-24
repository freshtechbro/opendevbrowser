"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getFocusableElements, getWrappedFocusTarget } from "@/components/layout/focus-trap";
import { CtaLink } from "@/components/shared/cta-link";

const navItems = [
  { href: "/product", label: "Product", includes: ["/product"] },
  { href: "/use-cases", label: "Solutions", includes: ["/use-cases", "/workflows"] },
  { href: "/security", label: "Trust", includes: ["/security", "/open-source"] },
  { href: "/docs", label: "Docs", includes: ["/docs", "/resources"] },
  { href: "/company", label: "Company", includes: ["/company"] }
] as const;

function isCurrent(pathname: string, includes: readonly string[]): boolean {
  return includes.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileSheetRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const mobileToggle = mobileToggleRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    const getFocusable = () => getFocusableElements(mobileSheetRef.current);

    const focusFirst = () => {
      const focusable = getFocusable();
      focusable[0]?.focus();
    };

    focusFirst();

    const onFocusIn = (event: FocusEvent) => {
      const sheet = mobileSheetRef.current;
      if (!sheet) {
        return;
      }

      if (event.target instanceof Node && sheet.contains(event.target)) {
        return;
      }

      focusFirst();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusable();
      if (focusable.length === 0) {
        return;
      }

      const wrappedTarget = getWrappedFocusTarget({
        focusable,
        activeElement: document.activeElement,
        shiftKey: event.shiftKey
      });
      if (wrappedTarget) {
        event.preventDefault();
        wrappedTarget.focus();
      }
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);

      if (mobileToggle && document.contains(mobileToggle)) {
        mobileToggle.focus();
        return;
      }

      previousActiveElement?.focus();
    };
  }, [mobileOpen]);

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand-wrap" aria-label="OpenDevBrowser home" onClick={() => setMobileOpen(false)}>
            <Image src="/brand/favicon.svg" alt="OpenDevBrowser logo" width={28} height={28} className="brand-icon" />
            <span className="brand-word">OpenDevBrowser</span>
          </Link>

          <nav className="primary-nav" aria-label="Primary">
            <ul>
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={isCurrent(pathname, item.includes) ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="header-actions">
            <CtaLink ctaId="global_top_nav_open_release_latest" className="icon-btn" aria-label="Open latest release on GitHub">
              <svg viewBox="0 0 16 16" aria-hidden focusable="false">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.53 2.29 6.53 5.47 7.59.4.08.55-.17.55-.38 0-.19-.01-.82-.01-1.5-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.53.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 4.66c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.94-.01 2.21 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </CtaLink>
            <CtaLink ctaId="global_top_nav_view_docs" className="btn btn-secondary">
              View Docs
            </CtaLink>
            <CtaLink ctaId="global_top_nav_get_started" className="btn btn-primary">
              Get Started
            </CtaLink>
            <button
              ref={mobileToggleRef}
              type="button"
              className="mobile-toggle"
              aria-label="Toggle mobile navigation"
              aria-expanded={mobileOpen}
              aria-controls="mobile-sheet"
              aria-haspopup="menu"
              onClick={() => setMobileOpen((current) => !current)}
            >
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                {mobileOpen ? (
                  <path d="M6 6 18 18M6 18 18 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                ) : (
                  <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </header>

      <nav id="mobile-sheet" ref={mobileSheetRef} className="mobile-sheet" data-open={mobileOpen} aria-label="Mobile" aria-hidden={!mobileOpen}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}>
            {item.label}
          </Link>
        ))}
        <div className="mobile-cta">
          <CtaLink ctaId="global_top_nav_get_started" className="btn btn-primary" onClick={() => setMobileOpen(false)}>
            Get Started
          </CtaLink>
          <CtaLink ctaId="global_top_nav_open_release_latest" className="btn btn-secondary" onClick={() => setMobileOpen(false)}>
            Download Latest Release
          </CtaLink>
        </div>
      </nav>
    </>
  );
}
