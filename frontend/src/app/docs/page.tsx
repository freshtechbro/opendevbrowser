import type { Metadata } from "next";
import Link from "next/link";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { TerminalBlock } from "@/components/shared/terminal-block";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { listDocsCategories } from "@/lib/docs/content";

export const metadata: Metadata = createRouteMetadata({
  title: "Docs",
  description: "Quickstart, mode selection, auth-aware workflow controls, and generated references for CLI, tools, and skills.",
  path: "/docs"
});

const installPaths = [
  {
    title: "npx path",
    detail: "Best for first runs, local trials, and CI smoke checks.",
    command: "npx opendevbrowser"
  },
  {
    title: "npm global",
    detail: "Install once for repeated local workflows and shell scripts.",
    command: "npm install -g opendevbrowser"
  },
  {
    title: "manual package",
    detail: "Use for pre-release first-run simulation from a local tarball.",
    command: "npm pack && npm install /path/to/opendevbrowser-<version>.tgz"
  }
];

const walkthrough = [
  "Install runtime and extension prerequisites for the mode you need (managed, extension, or cdpConnect).",
  "Start daemon, verify extension handshake status, then launch/connect and capture a baseline snapshot before actions.",
  "Execute actions/workflows, then verify status, diagnostics, cookie policy results, and cleanup state for deterministic completion."
];

export default function DocsGatewayPage() {
  const categories = listDocsCategories();

  return (
    <>
      <RouteHero
        title={
          <>
            Fastest path to <span className="grad">a verified first run</span>
          </>
        }
        description="Start with quickstart, pick the right mode, and then use generated references for commands, tools, workflows, extension, and skill packs."
        actions={
          <CtaLink ctaId="docs_start_quickstart" className="btn btn-primary">
            Quickstart
          </CtaLink>
        }
        visual={
          <TerminalBlock title="first-run">
            <span className="kw">npx</span> <span className="fn">opendevbrowser</span>
            {"\n"}
            <span className="fn">opendevbrowser launch</span>
            {"\n"}
            <span className="fn">opendevbrowser snapshot</span>
            {"\n"}
            <span className="fn">opendevbrowser click</span> <span className="str">&quot;ref:submit&quot;</span>
          </TerminalBlock>
        }
      />

      <SectionShell id="quickstart" title="Install and bootstrap" description="Choose the installation route that matches your operating model.">
        <div className="grid cols-3">
          {installPaths.map((path, index) => (
            <article key={path.title} className="card elevated reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>{path.title}</h3>
              <p>{path.detail}</p>
              <p className="meta">{path.command}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="First-run walkthrough" description="Three steps to complete an end-to-end run with explicit verification.">
        <div className="grid cols-3">
          {walkthrough.map((step, index) => (
            <article key={step} className="card reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>Step {index + 1}</h3>
              <p>{step}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Command discovery and parity" description="Keep installed CLI help output aligned with the canonical docs references.">
        <div className="grid cols-2">
          <article className="card reveal">
            <h3>Help inventory</h3>
            <p>Use both command forms during onboarding validation to confirm parity:</p>
            <p className="meta">npx opendevbrowser --help{"\n"}npx opendevbrowser help</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "90ms" }}>
            <h3>First-run checklist</h3>
            <p>Follow the full local-package onboarding checklist for daemon, extension, and first-task verification.</p>
            <div className="hero-actions" style={{ marginTop: 12 }}>
              <Link href="/docs" className="btn btn-secondary">
                Open Docs Index
              </Link>
            </div>
          </article>
        </div>
      </SectionShell>

      <SectionShell
        id="annotation"
        title="Annotation"
        description="Capture UI notes, element context, and structured payloads for implementation handoff."
      >
        <div className="grid cols-2">
          <article className="card reveal">
            <h3>What it does</h3>
            <p>Annotate live interfaces, attach comments to selected elements, and export payloads plus screenshots for reproducible review.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "90ms" }}>
            <h3>How to run it</h3>
            <p>Run the annotate command in managed or extension mode, then validate screenshots and annotation payloads in output artifacts.</p>
            <div className="hero-actions" style={{ marginTop: 12 }}>
              <Link href="/docs/cli/annotate" className="btn btn-secondary">
                Open Annotate Command
              </Link>
            </div>
          </article>
        </div>
      </SectionShell>

      <SectionShell
        title="Documentation category cards"
        description="Generated categories map directly to source-of-truth docs, tool code, and skill definitions in this repository."
      >
        <div className="grid cols-3">
          {categories.map((category, index) => {
            const firstPage = category.pages[0];
            const href = firstPage?.route ?? `/docs/${category.slug}`;
            return (
              <article key={category.slug} className="card elevated reveal" style={{ transitionDelay: `${index * 45}ms` }}>
                <h3>{category.title}</h3>
                <p>{category.pages.length} generated pages</p>
                <Link href={href} className="btn btn-secondary" style={{ marginTop: 12 }}>
                  Open category
                </Link>
              </article>
            );
          })}
        </div>
      </SectionShell>

      <SectionShell title="Troubleshooting preview" description="Operational friction is documented with explicit checks and recovery commands.">
        <div className="grid cols-2">
          <article className="card reveal">
            <h3>Readiness checks first</h3>
            <p>Start with status, handshake, and mode checks before executing actions or workflows.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "90ms" }}>
            <h3>Deterministic recovery</h3>
            <p>Follow command-level recovery sequences to isolate auth, relay, and target failures quickly.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell
        title="Auth and cookie controls"
        description="Workflow runs can explicitly control session cookie behavior per execution."
      >
        <div className="grid cols-3">
          <article className="card reveal">
            <h3>No-auth runs</h3>
            <p>Use `--use-cookies=false` or policy `off` for open browsing and deal-hunting runs that do not require login.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "70ms" }}>
            <h3>Mixed runs</h3>
            <p>Use policy `auto` to attempt cookie injection and continue when cookies are unavailable or rejected.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "140ms" }}>
            <h3>Strict auth runs</h3>
            <p>Use policy `required`; failures return explicit `auth_required` with structured `cookieDiagnostics` details.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell id="security" title="Community and support links" description="Use docs, repository issues, and release records for support workflows.">
        <div className="grid cols-3">
          <article className="card reveal"><h3>Repository</h3><p>Source code, issues, and releases for implementation truth.</p></article>
          <article className="card reveal" style={{ transitionDelay: "70ms" }}><h3>CLI reference</h3><p>Command-level behavior, flags, and examples from canonical docs.</p></article>
          <article className="card reveal" style={{ transitionDelay: "140ms" }}><h3>Troubleshooting</h3><p>Recovery patterns, diagnostics, and mode-specific operational checks.</p></article>
        </div>
      </SectionShell>
    </>
  );
}
