import type { Metadata } from "next";
import Image from "next/image";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { USE_CASES } from "@/data/page-content";

export const metadata: Metadata = createRouteMetadata({
  title: "Use Cases",
  description: "Automation lanes for QA, auth, extraction, ops, research, shopping, and asset workflows.",
  path: "/use-cases"
});

const personas = [
  "QA engineers",
  "Platform engineers",
  "Automation leads",
  "Growth operators",
  "Security reviewers",
  "AI product teams"
];

export default function UseCasesPage() {
  return (
    <>
      <RouteHero
        title={
          <>
            Ten lanes for <span className="grad">real automation outcomes</span>
          </>
        }
        description="Use OpenDevBrowser where repeatability, evidence, and operational confidence matter more than quick scripts."
        actions={
          <CtaLink ctaId="use_cases_explore_workflows" className="btn btn-primary">
            Explore Workflow Modules
          </CtaLink>
        }
        visual={
          <Image
            src="/brand/readme-image-candidates/2026-02-08/05-futuristic-control-surface.jpg"
            alt="Futuristic control surface visual for use-case mapping"
            width={1280}
            height={715}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
          />
        }
      />

      <SectionShell
        title="Expanded use-case lanes"
        description="All required lanes are mapped to validated repository capabilities and workflow modules."
      >
        <div className="grid cols-2">
          {USE_CASES.map((lane, index) => (
            <article key={lane.title} className="card reveal" style={{ transitionDelay: `${index * 35}ms` }}>
              <div className="feature-icon-chip" data-tone={index % 3 === 0 ? "teal" : index % 3 === 1 ? "cyan" : "violet"} aria-hidden>
                {lane.icon}
              </div>
              <h3>{lane.title}</h3>
              <p>{lane.snippet}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Persona chips"
        description="The same runtime serves both engineering and operations teams through one interaction model."
      >
        <div className="chip-row" style={{ justifyContent: "center" }}>
          {personas.map((persona) => (
            <span key={persona} className="chip reveal">
              {persona}
            </span>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Workflow handoff"
        description="Move from lane-level use cases to module-level workflows when you need standardized outputs."
      >
        <div className="grid cols-2">
          <article className="card elevated reveal">
            <h3>From lane to module</h3>
            <p>Use cases define intent. Workflow modules define inputs, execution stages, and deterministic outputs.</p>
          </article>
          <article className="card elevated reveal" style={{ transitionDelay: "90ms" }}>
            <h3>Cross-team alignment</h3>
            <p>Engineering and operations can share one execution surface and one evidence model without duplicate tooling.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell
        id="annotation"
        title="Annotation use case"
        description="Annotation is a core workflow for UI review loops: capture exact elements, attach comments, and pass structured payloads to agents."
      >
        <div className="grid cols-2">
          <article className="card elevated reveal">
            <h3>UI comments with payloads</h3>
            <p>Attach reviewer context to selected elements and generate artifacts that agents can consume without ambiguity.</p>
          </article>
          <article className="card elevated reveal" style={{ transitionDelay: "90ms" }}>
            <h3>Deterministic review handoff</h3>
            <p>Pair screenshots, element refs, and notes to speed up implementation and reduce back-and-forth.</p>
          </article>
        </div>
        <div className="hero-actions" style={{ marginTop: 16 }}>
          <CtaLink ctaId="use_cases_view_annotation" className="btn btn-primary">
            Open Annotation Docs
          </CtaLink>
        </div>
      </SectionShell>

      <section className="cta-band">
        <div className="cta-panel reveal">
          <h2>Choose a lane, then run the workflow</h2>
          <p>Start with workflow modules to convert use-case intent into stable outputs.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <CtaLink ctaId="use_cases_explore_workflows" className="btn btn-primary">
              Explore Workflow Modules
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
