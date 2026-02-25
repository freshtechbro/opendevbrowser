import type { Metadata } from "next";
import Image from "next/image";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { createRouteMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Company",
  description: "Mission and product principles for OpenDevBrowser.",
  path: "/company"
});

const principles = [
  "Deterministic automation over brittle heuristics",
  "Script-first interfaces before hidden behavior",
  "Security-by-default with explicit opt-in risk surfaces",
  "Observable operations with traceable evidence"
];

export default function CompanyPage() {
  return (
    <>
      <RouteHero
        title={
          <>
            Build reliable automation for <span className="grad">AI agent operations</span>
          </>
        }
        description="OpenDevBrowser builds deterministic, auditable browser automation infrastructure for engineering organizations."
        actions={
          <CtaLink ctaId="company_contact_team" className="btn btn-primary">
            Contact Team
          </CtaLink>
        }
        visual={
          <Image
            src="/brand/hero-image.png"
            alt="OpenDevBrowser automation hero visual"
            width={1200}
            height={675}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
          />
        }
      />

      <SectionShell title="Mission and product principles" description="These principles guide architecture, APIs, and release operations.">
        <div className="grid cols-2">
          {principles.map((principle, index) => (
            <article key={principle} className="card reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>Principle {index + 1}</h3>
              <p>{principle}</p>
            </article>
          ))}
        </div>
      </SectionShell>
    </>
  );
}
