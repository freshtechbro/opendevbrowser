import Image from "next/image";
import Link from "next/link";
import { CtaLink } from "@/components/shared/cta-link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <Link href="/" className="brand-wrap" aria-label="OpenDevBrowser home">
          <Image src="/brand/favicon.svg" alt="OpenDevBrowser logo" width={24} height={24} className="brand-icon" />
          <span className="brand-word">OpenDevBrowser</span>
        </Link>

        <ul className="footer-links">
          <li>
            <Link href="/docs">Docs</Link>
          </li>
          <li>
            <Link href="/security">Security</Link>
          </li>
          <li>
            <Link href="/resources#changelog">Changelog</Link>
          </li>
          <li>
            <CtaLink ctaId="global_footer_open_release_latest">Download Latest Release</CtaLink>
          </li>
          <li>
            <CtaLink ctaId="global_footer_view_readme">View README</CtaLink>
          </li>
        </ul>

        <p className="footer-copy">Copyright 2026 OpenDevBrowser. MIT License.</p>
      </div>
    </footer>
  );
}
