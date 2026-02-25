"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CtaLink } from "@/components/shared/cta-link";

export function StickyCta() {
  const pathname = usePathname() || "/";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;

    const updateVisibility = () => {
      raf = 0;
      const threshold = Math.max(240, window.innerHeight * 0.35);
      setVisible(window.scrollY > threshold);
    };

    const onViewportChange = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    window.addEventListener("scroll", onViewportChange, { passive: true });
    window.addEventListener("resize", onViewportChange);

    return () => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
      }
      window.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  if (pathname.startsWith("/docs") || pathname.startsWith("/contact")) {
    return null;
  }
  if (!visible) {
    return null;
  }

  return (
    <aside className="sticky-cta" aria-label="Sticky conversion actions">
      <p>Run your first deterministic browser flow today.</p>
      <CtaLink ctaId="global_sticky_get_started" className="btn btn-primary">
        Get Started
      </CtaLink>
      <CtaLink ctaId="global_sticky_download_latest_release" className="btn btn-secondary">
        Download Latest Release
      </CtaLink>
    </aside>
  );
}
