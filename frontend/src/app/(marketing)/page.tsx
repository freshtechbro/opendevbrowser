import type { Metadata } from "next";
import { CtaLink } from "@/components/shared/cta-link";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { ProofStrip } from "@/components/marketing/proof-strip";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { HOW_IT_WORKS, SECURITY_CARDS, USE_CASES } from "@/data/page-content";
import { getVerifiedMetrics, latestMetricAsOf } from "@/data/metrics";

export const metadata: Metadata = createRouteMetadata({
  title: "Home",
  description: "Script-first browser automation for AI agents with deterministic controls and production-ready workflow surfaces.",
  path: "/"
});

const VALUE_RAILS = [
  {
    icon: "📸",
    tone: "teal",
    title: "Deterministic action model",
    detail: "Snapshot to refs to actions replaces brittle selectors with stable references for repeatable automation behavior.",
    meta: "snapshot to refs to actions"
  },
  {
    icon: "🛡️",
    tone: "cyan",
    title: "Security and controls",
    detail: "Token auth, origin checks, and redaction defaults create strong execution boundaries without slowing down delivery.",
    meta: "defense in depth"
  },
  {
    icon: "🧩",
    tone: "violet",
    title: "Workflow modules",
    detail: "Research, shopping, and product video surfaces convert low-level actions into high-level outcome pipelines.",
    meta: "modular orchestration"
  }
] as const;

export default function HomePage() {
  const verified = getVerifiedMetrics();
  const cliMetric = Number.parseInt(verified.find((metric) => metric.label.toLowerCase().includes("cli"))?.value ?? "55", 10);
  const toolMetric = Number.parseInt(verified.find((metric) => metric.label.toLowerCase().includes("tool"))?.value ?? "48", 10);
  const coverageMetric = Math.round(Number.parseFloat(verified.find((metric) => metric.label.toLowerCase().includes("branch coverage"))?.value ?? "97"));
  const asOf = latestMetricAsOf().slice(0, 10);

  return (
    <>
      <RouteHero
        title={
          <>
            Script-first <span className="grad">browser automation</span> for AI agents
          </>
        }
        description="Launch, snapshot, and execute deterministic browser actions across managed, extension, and CDP modes from one script-first platform."
        actions={
          <>
            <CtaLink ctaId="home_get_started_quickstart" className="btn btn-primary">
              Get Started
            </CtaLink>
            <CtaLink ctaId="global_top_nav_open_release_latest" className="btn btn-secondary">
              View Latest Release
            </CtaLink>
          </>
        }
        visual={<HeroVisual />}
      />

      <ProofStrip
        metrics={[
          { label: "CLI commands", value: cliMetric, meta: `as_of_utc ${asOf}` },
          { label: "Built-in tools", value: toolMetric, meta: "source src/tools/index.ts" },
          { label: "Coverage gate", value: coverageMetric, meta: "branch threshold" },
          { label: "Runtime modes", value: 3, meta: "managed extension cdp" }
        ]}
      />

      <SectionShell
        id="value-icons"
        title="Built for technical teams that verify outcomes"
        description="Three value rails summarize deterministic execution, secure operations, and modular workflow outcomes."
      >
        <div className="grid cols-3">
          {VALUE_RAILS.map((rail, index) => (
            <article
              key={rail.title}
              className={`card elevated reveal ${index === 1 ? "delay-md" : index === 2 ? "delay-lg" : ""}`.trim()}
            >
              <div className="feature-icon-chip" data-tone={rail.tone} aria-hidden>
                {rail.icon}
              </div>
              <h3>{rail.title}</h3>
              <p>{rail.detail}</p>
              <p className="meta">{rail.meta}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell id="how-it-works" title="How it works" description="The validated seven-step workflow from launch to close.">
        <div className="grid cols-4">
          {HOW_IT_WORKS.map((item, index) => (
            <article key={item.step} className={`card reveal ${index > 0 ? "delay-md" : ""}`.trim()}>
              <h3>
                {index + 1}. {item.step}
              </h3>
              <p>{item.detail}</p>
              <p className="meta">{item.meta}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        id="use-cases"
        title="Expanded use-case preview"
        description="Ten required lanes spanning QA, extraction, operations, and workflow-driven outcomes."
      >
        <div className="grid cols-2">
          {USE_CASES.map((lane, index) => (
            <article key={lane.title} className={`card reveal ${index % 2 === 1 ? "delay-sm" : ""}`.trim()}>
              <div className="feature-icon-chip" data-tone={index % 2 === 0 ? "teal" : "cyan"} aria-hidden>
                {lane.icon}
              </div>
              <h3>{lane.title}</h3>
              <p>{lane.snippet}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        id="security-preview"
        title="Security preview"
        description="Concise trust posture aligned to enforceable runtime and operational controls."
      >
        <div className="grid cols-3">
          {SECURITY_CARDS.slice(0, 3).map((card, index) => (
            <article key={card.title} className={`card reveal ${index === 1 ? "delay-md" : index === 2 ? "delay-lg" : ""}`.trim()}>
              <div className="feature-icon-chip" data-tone={index === 0 ? "teal" : index === 1 ? "cyan" : "indigo"} aria-hidden>
                {card.icon}
              </div>
              <h3>{card.title}</h3>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        id="open-source-preview"
        title="Open source preview"
        description="MIT licensed now, roadmap-driven next, and structured for contributions."
      >
        <div className="grid cols-1">
          <article className="card elevated reveal">
            <span className="badge">MIT license • v0.0.15</span>
            <h3 style={{ marginTop: 12 }}>What ships today</h3>
            <p>
              Core runtime, {toolMetric} tools, {cliMetric} commands, extension relay, workflow wrappers, and skill packs are already available.
            </p>
            <p className="meta">
              Includes first-run onboarding, CLI/help parity docs, and dependency inventory for release verification.
            </p>
            <div className="chip-row" style={{ marginTop: 12 }}>
              <span className="chip">core runtime</span>
              <span className="chip">cli surface</span>
              <span className="chip">extension relay</span>
              <span className="chip">workflow modules</span>
            </div>
            <div className="hero-actions" style={{ marginTop: 16 }}>
              <CtaLink ctaId="open_source_view_latest_release" className="btn btn-primary">
                View Latest Release
              </CtaLink>
              <CtaLink ctaId="open_source_view_github_repo" className="btn btn-secondary">
                View GitHub Repo
              </CtaLink>
            </div>
          </article>
        </div>
      </SectionShell>

      <section className="cta-band">
        <div className="cta-panel reveal">
          <h2>Ready to automate at production depth?</h2>
          <p>Open source, auditable, and structured for AI agent workflows from day one.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <CtaLink ctaId="home_get_started_quickstart" className="btn btn-primary">
              Get Started
            </CtaLink>
            <CtaLink ctaId="global_top_nav_view_docs" className="btn btn-secondary">
              Read Docs
            </CtaLink>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "OpenDevBrowser",
              url: "https://github.com/freshtechbro/opendevbrowser"
            },
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "OpenDevBrowser",
              applicationCategory: "DeveloperApplication",
              license: "https://opensource.org/license/mit",
              operatingSystem: "macOS, Windows, Linux"
            }
          ])
        }}
      />
    </>
  );
}
