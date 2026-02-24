import type { Metadata } from "next";
import Image from "next/image";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { SECURITY_CARDS } from "@/data/page-content";

export const metadata: Metadata = createRouteMetadata({
  title: "Security",
  description: "Security and operational controls for deterministic browser automation at production scale.",
  path: "/security"
});

const references = [
  "src/config.ts",
  "src/relay/relay-server.ts",
  "docs/CLI.md",
  "docs/TROUBLESHOOTING.md",
  "vitest.config.ts",
  "docs/SURFACE_REFERENCE.md"
];

export default function SecurityPage() {
  return (
    <>
      <RouteHero
        title={
          <>
            Security posture with <span className="grad">operational controls</span>
          </>
        }
        description="Trust claims map directly to runtime code paths, validation checks, and observable status surfaces."
        actions={
          <CtaLink ctaId="security_view_docs_security" className="btn btn-primary">
            Security Docs
          </CtaLink>
        }
        visual={
          <Image
            src="/brand/readme-image-candidates/2026-02-08/02-relay-architecture-isometric.jpg"
            alt="Security and relay architecture visual"
            width={1280}
            height={715}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
          />
        }
      />

      <SectionShell
        title="Secure defaults snapshot"
        description="Unsafe capabilities are opt-in and bounded by explicit configuration contracts."
      >
        <div className="grid cols-3">
          <article className="card reveal">
            <h3>Raw CDP controls disabled</h3>
            <p>Direct low-level capabilities require explicit enablement before execution.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "70ms" }}>
            <h3>Non-local endpoints restricted</h3>
            <p>Network boundaries prioritize local-only operation unless intentionally configured.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "140ms" }}>
            <h3>Unsafe export paths blocked</h3>
            <p>Sanitization and guardrails are defaulted to safe behavior.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="Relay, token, and origin controls" description="Connection channels enforce explicit checks before accepting command traffic.">
        <div className="grid cols-3">
          {SECURITY_CARDS.map((card, index) => (
            <article key={card.title} className="card reveal" style={{ transitionDelay: `${index * 55}ms` }}>
              <h3>{card.title}</h3>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Data redaction and reliability" description="Production operations require both privacy discipline and deterministic failure handling.">
        <div className="grid cols-2">
          <article className="card elevated reveal">
            <h3>Data redaction handling</h3>
            <p>Sensitive values are filtered before diagnostics and exported artifacts are surfaced.</p>
          </article>
          <article className="card elevated reveal" style={{ transitionDelay: "90ms" }}>
            <h3>Reliability and testing posture</h3>
            <p>Release checks enforce build, lint, type, and coverage confidence before publication.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="Operational references" description="Each trust claim is mapped to concrete code and documentation references.">
        <div className="grid cols-3">
          {references.map((item, index) => (
            <article key={item} className="card reveal" style={{ transitionDelay: `${index * 50}ms` }}>
              <h3>{item}</h3>
              <p>Source path used to validate controls and operational behavior claims.</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <section className="cta-band">
        <div className="cta-panel reveal">
          <h2>Review the full security model</h2>
          <p>Open the security anchor in docs for implementation-level details and operational procedures.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <CtaLink ctaId="security_view_docs_security" className="btn btn-primary">
              Security Docs
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
