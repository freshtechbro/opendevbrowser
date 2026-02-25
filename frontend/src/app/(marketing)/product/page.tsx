import type { Metadata } from "next";
import Image from "next/image";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { TerminalBlock } from "@/components/shared/terminal-block";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { PRODUCT_CAPABILITIES } from "@/data/page-content";

export const metadata: Metadata = createRouteMetadata({
  title: "Product",
  description: "Runtime mode model and feature surfaces for implementation-focused teams.",
  path: "/product"
});

const clusters = [
  { title: "Navigation and interaction", detail: "goto, snapshot, click, type, select, scroll, and wait flows." },
  { title: "DOM and extraction", detail: "HTML, text, attr/value/state inspection for deterministic extraction logic." },
  { title: "Diagnostics", detail: "console, network, trace snapshots, and perf surfaces for regression analysis." },
  { title: "Export and artifact", detail: "screenshot, clone page/component, annotate, and rich output pipelines." },
  { title: "Macro and orchestration", detail: "macro resolve and workflow wrappers for reusable automation sequences." },
  { title: "Session and targets", detail: "launch/connect/status and page/target management controls." }
];

export default function ProductPage() {
  return (
    <>
      <RouteHero
        title={
          <>
            Technical architecture with <span className="grad">deterministic surfaces</span>
          </>
        }
        description="OpenDevBrowser combines a script-first runtime, extension relay, and diagnostics stack into one implementation-ready architecture."
        actions={
          <CtaLink ctaId="product_read_docs" className="btn btn-primary">
            Read Docs
          </CtaLink>
        }
        visual={
          <Image
            src="/brand/readme-image-candidates/2026-02-08/02-relay-architecture-isometric.jpg"
            alt="Isometric relay architecture visualization"
            width={1280}
            height={715}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
          />
        }
      />

      <SectionShell
        title="Runtime architecture map"
        description="Browser manager, relay, tools, and workflow modules operate as composable layers."
      >
        <div className="grid cols-3">
          {PRODUCT_CAPABILITIES.map((item, index) => (
            <article key={item.title} className="card elevated reveal" style={{ transitionDelay: `${index * 55}ms` }}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Mode comparison"
        description="Choose the right runtime mode for each execution context without changing tool semantics."
      >
        <div className="grid cols-3">
          <article className="card reveal">
            <h3>Managed</h3>
            <p>Full lifecycle control with isolated browser process management and deterministic startup behavior.</p>
            <p className="meta">launch --no-extension</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "80ms" }}>
            <h3>Extension ops</h3>
            <p>Operate in existing logged-in tabs through relay channels and policy-aware controls.</p>
            <p className="meta">launch --extension-only</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "160ms" }}>
            <h3>Legacy CDP</h3>
            <p>Direct CDP attachment path for integration with existing remote debugging setups.</p>
            <p className="meta">connect --extension-legacy</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="Tool surface clusters" description="Feature domains are grouped for predictable implementation paths.">
        <div className="grid cols-3">
          {clusters.map((cluster, index) => (
            <article key={cluster.title} className="card reveal" style={{ transitionDelay: `${index * 50}ms` }}>
              <h3>{cluster.title}</h3>
              <p>{cluster.detail}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Diagnostics and verification surfaces"
        description="Regression-safe operations require observable state at every stage of execution."
      >
        <div className="grid cols-2">
          <TerminalBlock title="diagnostics.sh">
            <span className="fn">opendevbrowser status</span>
            {"\n"}
            <span className="fn">opendevbrowser console-poll</span>
            {"\n"}
            <span className="fn">opendevbrowser network-poll</span>
            {"\n"}
            <span className="fn">opendevbrowser debug-trace-snapshot</span>
            {"\n"}
            <span className="fn">opendevbrowser perf</span>
          </TerminalBlock>
          <article className="card elevated reveal">
            <h3>Verification model</h3>
            <p>Each claim on the landing surface maps to source files, command surfaces, and testable runtime behavior.</p>
            <p className="meta">runtime + tests + observable outputs</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="Export and artifact surfaces" description="Capture outputs for QA, reports, and downstream automation loops.">
        <div className="grid cols-3">
          <article className="card reveal"><h3>Screenshots</h3><p>Collect visual evidence from deterministic browser states.</p></article>
          <article className="card reveal" style={{ transitionDelay: "70ms" }}><h3>Clone page/component</h3><p>Extract reusable front-end structures from live DOM state.</p></article>
          <article className="card reveal" style={{ transitionDelay: "140ms" }}><h3>Annotation</h3><p>Capture structured review metadata with screenshot artifacts.</p></article>
        </div>
      </SectionShell>

      <SectionShell title="Workflow integration block" description="Connect low-level action controls with high-level business workflows.">
        <div className="grid cols-2">
          <article className="card elevated reveal">
            <h3>Composable flow</h3>
            <p>Launch/action tools feed research, shopping, and product-video wrappers through one deterministic contract.</p>
          </article>
          <article className="card elevated reveal" style={{ transitionDelay: "90ms" }}>
            <h3>Policy-aware execution</h3>
            <p>Per-run cookie controls and structured diagnostics (`auth_required`, `cookieDiagnostics`) keep auth-sensitive workflows predictable.</p>
          </article>
        </div>
      </SectionShell>

      <section className="cta-band">
        <div className="cta-panel reveal">
          <h2>Go from architecture to execution</h2>
          <p>Dive into docs for implementation details, command references, and operation patterns.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <CtaLink ctaId="product_read_docs" className="btn btn-primary">
              Read Docs
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
