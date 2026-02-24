"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { type MouseEvent, type ReactNode } from "react";
import { CTA_REGISTRY, type CtaId, resolveCtaDestination } from "@/data/cta-registry";
import { dispatchCtaEvent, getAnalyticsSessionId, getDeviceType } from "@/lib/analytics/cta";

type CtaLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  Pick<LinkProps, "prefetch"> & {
    ctaId: CtaId;
    sourcePath?: string;
    href?: string;
    children: ReactNode;
  };

export function CtaLink({ ctaId, sourcePath, href, children, onClick, prefetch, ...rest }: CtaLinkProps) {
  const pathname = usePathname() || "/";
  const entry = CTA_REGISTRY[ctaId];
  const resolved = href ?? resolveCtaDestination(ctaId, sourcePath);

  const track = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }

    const route = (pathname.startsWith("/") ? pathname : `/${pathname}`) as `/${string}`;

    const payload = {
      event_name: "cta_click" as const,
      route,
      section_id: entry.sectionId,
      cta_id: ctaId,
      destination_url: typeof resolved === "string" ? resolved : String(resolved),
      timestamp: new Date().toISOString(),
      session_id: getAnalyticsSessionId(),
      device_type: getDeviceType(window.innerWidth)
    };

    try {
      dispatchCtaEvent(payload);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        throw error;
      }
      console.error(error);
    }
  };

  if (typeof resolved === "string" && /^https?:\/\//u.test(resolved)) {
    return (
      <a href={resolved} onClick={track} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <Link
      href={resolved}
      prefetch={prefetch}
      onClick={track}
      {...rest}
    >
      {children}
    </Link>
  );
}
