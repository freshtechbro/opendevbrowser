import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CtaLink } from "@/components/shared/cta-link";
import { RouteHero } from "@/components/marketing/route-hero";
import { SectionShell } from "@/components/shared/section-shell";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { getDocCategoryRoot } from "@/lib/docs/content";

export const metadata: Metadata = createRouteMetadata({
  title: "Resources",
  description: "Changelog, guides, templates, and implementation references for ongoing OpenDevBrowser adoption.",
  path: "/resources"
});

const changelogItems = [
  { version: "v0.0.15", note: "Current release baseline with verified command and tool surfaces." },
  { version: "v0.0.14", note: "Stability and diagnostics enhancements across runtime surfaces." },
  { version: "v0.0.13", note: "Workflow module and docs surface expansion." }
];

const guideCards = [
  { title: "QA loop guide", href: "/docs/guides/qa-loop", detail: "Repeatable QA checks with trace-backed evidence." },
  { title: "Data extraction guide", href: "/docs/guides/data-extraction", detail: "Structured extraction flows with reproducible outputs." },
  { title: "Auth automation guide", href: "/docs/guides/auth-automation", detail: "Policy-aware auth runs with cookie diagnostics." },
  { title: "Visual QA guide", href: "/docs/guides/visual-qa", detail: "Screenshot and annotation loops for fast UI review." },
  { title: "UI component extraction guide", href: "/docs/guides/ui-component-extraction", detail: "Component and page cloning playbook." },
  { title: "Ops monitoring guide", href: "/docs/guides/ops-monitoring", detail: "Runtime health and regression detection flow." }
];

const referenceLinks = [
  { label: "CLI reference", href: "/docs/cli" },
  { label: "Tools reference", href: "/docs/tools" },
  { label: "Architecture", href: "/docs/concepts/session-modes" },
  { label: "Extension setup", href: "/docs/extension/setup" }
];

const assetPreview = [
  { src: "/brand/logo-primary.png", alt: "Primary logo", label: "logo-primary.png" },
  { src: "/brand/logo-dark.png", alt: "Dark logo", label: "logo-dark.png" },
  { src: "/brand/logo-light.png", alt: "Light logo", label: "logo-light.png" },
  { src: "/brand/favicon.svg", alt: "SVG favicon", label: "favicon.svg" },
  { src: "/brand/favicon-16x16.png", alt: "Favicon 16", label: "favicon-16x16.png" },
  { src: "/brand/favicon-32x32.png", alt: "Favicon 32", label: "favicon-32x32.png" },
  { src: "/brand/favicon.ico", alt: "Favicon ICO", label: "favicon.ico" },
  { src: "/brand/icon-16.png", alt: "Icon 16", label: "icon-16.png" },
  { src: "/brand/icon-32.png", alt: "Icon 32", label: "icon-32.png" },
  { src: "/brand/icon-48.png", alt: "Icon 48", label: "icon-48.png" },
  { src: "/brand/icon-128.png", alt: "Icon 128", label: "icon-128.png" },
  { src: "/brand/icon-256.png", alt: "Icon 256", label: "icon-256.png" },
  { src: "/brand/icon-512.png", alt: "Icon 512", label: "icon-512.png" },
  { src: "/brand/icon-1024.png", alt: "Icon 1024", label: "icon-1024.png" },
  { src: "/brand/extension-icons/icon16.png", alt: "Extension icon 16", label: "extension-icons/icon16.png" },
  { src: "/brand/extension-icons/icon32.png", alt: "Extension icon 32", label: "extension-icons/icon32.png" },
  { src: "/brand/extension-icons/icon48.png", alt: "Extension icon 48", label: "extension-icons/icon48.png" },
  { src: "/brand/extension-icons/icon128.png", alt: "Extension icon 128", label: "extension-icons/icon128.png" },
  { src: "/brand/social-og.png", alt: "Social OG banner", label: "social-og.png" },
  { src: "/brand/github-social.png", alt: "GitHub social banner", label: "github-social.png" },
  { src: "/brand/hero-image.png", alt: "Hero image", label: "hero-image.png" }
];

export default function ResourcesPage() {
  const changelogDoc = getDocCategoryRoot("changelog");

  return (
    <>
      <RouteHero
        title={
          <>
            Resources for <span className="grad">continuous delivery</span>
          </>
        }
        description="Track release changes, run implementation guides, and pull canonical references from generated docs surfaces."
        actions={
          <CtaLink ctaId="resources_view_changelog" className="btn btn-primary">
            View Changelog
          </CtaLink>
        }
        visual={
          <article className="card elevated" style={{ height: "100%" }}>
            <h3>Release summary</h3>
            <p>{changelogDoc?.summary ?? "Latest release intelligence from canonical changelog."}</p>
          </article>
        }
      />

      <SectionShell id="changelog" title="Changelog timeline" description="Version deltas summarized for fast operational review.">
        <div className="grid cols-3">
          {changelogItems.map((item, index) => (
            <article key={item.version} className="card reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>{item.version}</h3>
              <p>{item.note}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Guides and tutorials" description="Actionable playbooks for high-frequency automation lanes.">
        <div className="grid cols-3">
          {guideCards.map((guide, index) => (
            <article key={guide.href} className="card elevated reveal" style={{ transitionDelay: `${index * 50}ms` }}>
              <h3>{guide.title}</h3>
              <p>{guide.detail}</p>
              <Link className="btn btn-secondary" href={guide.href} style={{ marginTop: 10 }}>
                Open guide
              </Link>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Examples and templates" description="Reference templates accelerate first implementations and onboarding.">
        <div className="grid cols-2">
          <article className="card reveal">
            <h3>Workflow templates</h3>
            <p>Reusable command sequences for research, shopping, and product-video automation loops.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "90ms" }}>
            <h3>Ops checklists</h3>
            <p>Deterministic validation and recovery checklists for runtime incidents and release gates.</p>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="API and reference links" description="Generated docs are grouped by category for rapid lookup.">
        <div className="grid cols-2">
          {referenceLinks.map((link, index) => (
            <article key={link.href} className="card reveal" style={{ transitionDelay: `${index * 70}ms` }}>
              <h3>{link.label}</h3>
              <p>Navigate to generated reference routes for complete details.</p>
              <Link className="btn btn-secondary" href={link.href} style={{ marginTop: 10 }}>
                Open
              </Link>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Asset inventory preview" description="Design and brand assets from assets/ and extension-icons are included in the frontend pack.">
        <div className="grid cols-3">
          {assetPreview.map((asset, index) => (
            <article key={asset.src} className="card elevated reveal" style={{ transitionDelay: `${index * 18}ms` }}>
              <Image
                src={asset.src}
                alt={asset.alt}
                width={512}
                height={320}
                style={{ borderRadius: 10, marginBottom: 10, width: "100%", height: "120px", objectFit: "contain", background: "var(--color-surface-1)" }}
              />
              <h3>{asset.label}</h3>
              <p>Synced via frontend/scripts/sync-brand-assets.mjs</p>
            </article>
          ))}
        </div>
      </SectionShell>
    </>
  );
}
