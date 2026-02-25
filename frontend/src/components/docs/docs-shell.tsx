"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocsManifest } from "@/lib/docs/types";

const PREF_KEY = "odb-docs-sidebar";

function useOverlayMode() {
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    const compute = () => {
      setOverlay(window.innerWidth < 768);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return overlay;
}

export function DocsShell({ manifest, children }: { manifest: DocsManifest; children: ReactNode }) {
  const pathname = usePathname() || "/docs";
  const isOverlay = useOverlayMode();
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(PREF_KEY);
    if (stored === "collapsed") {
      setCollapsed(true);
      return;
    }
    if (stored === "expanded") {
      setCollapsed(false);
      return;
    }
    setCollapsed(window.innerWidth < 1024);
  }, []);

  useEffect(() => {
    if (!isOverlay) {
      setOverlayOpen(false);
    }
  }, [isOverlay]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shouldToggle = (event.metaKey || event.ctrlKey) && event.key === "\\";
      if (shouldToggle) {
        event.preventDefault();
        if (isOverlay) {
          setOverlayOpen((open) => !open);
        } else {
          setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem(PREF_KEY, next ? "collapsed" : "expanded");
            return next;
          });
        }
      }

      if (event.key === "Escape" && isOverlay && overlayOpen) {
        setOverlayOpen(false);
        toggleRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOverlay, overlayOpen]);

  useEffect(() => {
    if (!isOverlay || !overlayOpen || !sidebarRef.current) return;

    const focusable = sidebarRef.current.querySelectorAll<HTMLElement>(
      "a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])"
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [isOverlay, overlayOpen]);

  const className = useMemo(() => {
    const parts = ["docs-layout"];
    if (!isOverlay && collapsed) parts.push("sidebar-collapsed");
    if (isOverlay && overlayOpen) parts.push("sidebar-overlay-open");
    return parts.join(" ");
  }, [collapsed, isOverlay, overlayOpen]);

  return (
    <>
      <div className={className}>
        <aside id="docs-sidebar" className="docs-sidebar" aria-label="Documentation navigation" ref={sidebarRef}>
          <nav>
            {manifest.categories.map((category) => (
              <section key={category.slug} className="docs-nav-group">
                <p>{category.title}</p>
                <ul>
                  {category.pages.map((page) => {
                    const active = pathname === page.route;
                    return (
                      <li key={page.route}>
                        <Link
                          href={page.route}
                          className="docs-nav-link"
                          aria-current={active ? "page" : undefined}
                          onClick={() => setOverlayOpen(false)}
                        >
                          <span>{page.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
        </aside>

        <div className="docs-content">{children}</div>
        <div className="docs-overlay" aria-hidden onClick={() => setOverlayOpen(false)} />
      </div>

      <button
        ref={toggleRef}
        id="docs-sidebar-toggle"
        type="button"
        className="docs-sidebar-toggle"
        aria-controls="docs-sidebar"
        aria-expanded={isOverlay ? overlayOpen : !collapsed}
        onClick={() => {
          if (isOverlay) {
            setOverlayOpen((open) => !open);
            return;
          }
          setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem(PREF_KEY, next ? "collapsed" : "expanded");
            return next;
          });
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h10v2H4v-2Z" />
        </svg>
      </button>
    </>
  );
}
