import type { Metadata } from "next";
import Image from "next/image";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { WORKFLOW_MODULES } from "@/data/page-content";

export const metadata: Metadata = createRouteMetadata({
  title: "Workflows",
  description: "Research, shopping, and product-video workflow modules with deterministic inputs, policy-aware execution, and structured outputs.",
  path: "/workflows"
});

export default function WorkflowsPage() {
  return (
    <>
      <RouteHero
        eyebrow="Workflow modules"
        title={
          <>
            Module-level execution with <span className="grad">structured outputs</span>
          </>
        }
        description="Research, shopping, and product-video modules combine low-level browser actions into repeatable pipelines with policy-aware session controls."
        actions={
          <CtaLink ctaId="workflows_start_quickstart" className="btn btn-primary">
            Start with Quickstart
          </CtaLink>
        }
        visual={
          <Image
            src="/brand/hero-image.png"
            alt="OpenDevBrowser workflow hero image"
            width={1280}
            height={715}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
          />
        }
      />

      <SectionShell title="Workflow tabs" description="Each module exposes a deterministic contract with explicit pipeline stages.">
        <div className="grid cols-3">
          {WORKFLOW_MODULES.map((module, index) => (
            <article key={module.key} className="card elevated reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>{module.title}</h3>
              <p>{module.useCase}</p>
              <p className="meta">{module.key}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Pipeline view" description="Inputs, execution stages, and outputs are explicit for each module.">
        <div className="grid cols-3">
          {WORKFLOW_MODULES.map((module, index) => (
            <article key={module.title} className="card reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>{module.title}</h3>
              <p>
                <strong>Inputs:</strong> {module.inputs}
              </p>
              <p>
                <strong>Stages:</strong> {module.stages}
              </p>
              <p>
                <strong>Outputs:</strong> {module.outputs}
              </p>
              <p className="meta">linked lane: {module.useCase}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Session and auth behavior"
        description="Provider workflows expose deterministic cookie policy modes for unauthenticated and authenticated runs."
      >
        <div className="grid cols-3">
          <article className="card reveal">
            <h3>`off`</h3>
            <p>Skips cookie injection for open browsing lanes like deal hunting where auth is unnecessary.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "70ms" }}>
            <h3>`auto`</h3>
            <p>Attempts cookies when available and continues when they are missing, ideal for mixed public/private targets.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "140ms" }}>
            <h3>`required`</h3>
            <p>Fails fast with `auth_required` when cookie injection/verification cannot establish the required session state.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="Output preview wall" description="Workflow outputs include report artifacts, visual captures, and normalized execution records.">
        <div className="grid cols-3">
          <article className="card elevated reveal">
            <Image
              src="/brand/readme-image-candidates/2026-02-08/04-annotation-automation-scene.jpg"
              alt="Annotation automation scene"
              width={1024}
              height={572}
              style={{ borderRadius: 12, marginBottom: 10 }}
            />
            <h3>Visual artifacts</h3>
            <p>Screenshots and annotation payloads for QA and design review loops.</p>
          </article>
          <article className="card elevated reveal" style={{ transitionDelay: "80ms" }}>
            <Image
              src="/brand/readme-image-candidates/2026-02-08/03-snapshot-refs-actions-abstract.jpg"
              alt="Snapshot refs actions abstract"
              width={1024}
              height={572}
              style={{ borderRadius: 12, marginBottom: 10 }}
            />
            <h3>Structured extraction</h3>
            <p>Snapshot-driven references and deterministic action records across workflow stages.</p>
          </article>
          <article className="card elevated reveal" style={{ transitionDelay: "160ms" }}>
            <Image
              src="/brand/readme-image-candidates/2026-02-08/02-relay-architecture-isometric.jpg"
              alt="Relay architecture isometric"
              width={1024}
              height={572}
              style={{ borderRadius: 12, marginBottom: 10 }}
            />
            <h3>Runtime traceability</h3>
            <p>Operational metadata links module outputs back to command-level runtime evidence.</p>
          </article>
        </div>
      </SectionShell>

      <section className="cta-band">
        <div className="cta-panel reveal">
          <h2>Run your first module now</h2>
          <p>Use quickstart docs to launch, configure, and execute workflow modules with confidence.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <CtaLink ctaId="workflows_start_quickstart" className="btn btn-primary">
              Start with Quickstart
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
