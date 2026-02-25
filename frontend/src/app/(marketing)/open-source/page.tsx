import type { Metadata } from "next";
import Image from "next/image";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { TerminalBlock } from "@/components/shared/terminal-block";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { getRoadmapMilestones } from "@/data/roadmap";

export const metadata: Metadata = createRouteMetadata({
  title: "Open Source",
  description: "Open source scope, release path, contribution model, and public roadmap for OpenDevBrowser.",
  path: "/open-source"
});

const includedNow = [
  "Core runtime and browser managers",
  "CLI command surface and daemon operations",
  "Tool registry and workflow wrappers",
  "Chrome extension relay mode",
  "Skill packs and generated docs surfaces"
];

const contribution = [
  "Issue-first proposal and reproducible evidence",
  "Focused pull requests with tests and docs updates",
  "Parity checks for CLI and tool surfaces",
  "Security and regression review before release"
];

export default function OpenSourcePage() {
  const milestones = getRoadmapMilestones();

  return (
    <>
      <RouteHero
        eyebrow="Open source first"
        title={
          <>
            Open delivery with <span className="grad">clear release paths</span>
          </>
        }
        description="OpenDevBrowser ships under MIT with transparent release flow, contribution guidelines, and a public roadmap."
        actions={
          <>
            <CtaLink ctaId="open_source_view_latest_release" className="btn btn-primary">
              View Latest Release
            </CtaLink>
            <CtaLink ctaId="open_source_view_github_repo" className="btn btn-secondary">
              View GitHub Repo
            </CtaLink>
          </>
        }
        visual={
          <Image
            src="/brand/github-social.png"
            alt="Open source social banner"
            width={1280}
            height={640}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
          />
        }
      />

      <SectionShell title="What is included now" description="Current scope covers runtime, tooling, extension, and workflow modules.">
        <div className="grid cols-2">
          <article className="card elevated reveal">
            <span className="badge">MIT Licensed</span>
            <div style={{ marginTop: 14 }} className="grid cols-1">
              {includedNow.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </article>
          <TerminalBlock title="release-path.sh">
            <span className="cmt"># check release</span>{"\n"}
            <span className="kw">open</span> <span className="str">https://github.com/freshtechbro/opendevbrowser/releases/latest</span>
            {"\n\n"}
            <span className="cmt"># install and verify</span>{"\n"}
            <span className="kw">npx</span> <span className="fn">opendevbrowser</span>
            {"\n"}
            <span className="fn">opendevbrowser version</span>
          </TerminalBlock>
        </div>
      </SectionShell>

      <SectionShell title="Contribution model" description="Contribution workflow prioritizes reproducibility, test integrity, and docs parity.">
        <div className="grid cols-2">
          {contribution.map((item, index) => (
            <article key={item} className="card reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>Contribution step {index + 1}</h3>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Public roadmap" description="Roadmap tracks are sourced from docs/OPEN_SOURCE_ROADMAP.md and shown with status.">
        <div className="grid cols-3">
          {milestones.map((milestone, index) => (
            <article key={milestone.milestone} className="card elevated reveal" style={{ transitionDelay: `${index * 65}ms` }}>
              <span className="badge">{milestone.status}</span>
              <h3 style={{ marginTop: 10 }}>{milestone.milestone}</h3>
              <p>{milestone.goal}</p>
              <p className="meta">{milestone.window}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <section className="cta-band">
        <div className="cta-panel reveal">
          <h2>Download and inspect the latest release</h2>
          <p>Everything on this page is linked to source files, release assets, and public roadmap records.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <CtaLink ctaId="open_source_view_latest_release" className="btn btn-primary">
              View Latest Release
            </CtaLink>
            <CtaLink ctaId="open_source_view_github_repo" className="btn btn-secondary">
              View GitHub Repo
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
