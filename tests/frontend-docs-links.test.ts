import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CTA_REGISTRY, resolveCtaDestination } from "../frontend/src/data/cta-registry";

type Manifest = {
  categories: Array<{
    slug: string;
    pages: Array<{ slug: string; route: string }>;
  }>;
};

type Pages = {
  pages: Record<string, unknown>;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(dirname, "..", "frontend");

function loadJson<T>(relativePath: string): T {
  const absolutePath = path.join(frontendRoot, relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

describe("frontend CTA registry semantics", () => {
  it("keeps core marketing CTA destinations aligned with intended routes", () => {
    expect(CTA_REGISTRY.global_top_nav_view_docs.destination).toBe("/docs");
    expect(CTA_REGISTRY.global_top_nav_get_started.destination).toBe("/docs/quickstart");
    expect(CTA_REGISTRY.product_read_docs.destination).toBe("/docs");
    expect(CTA_REGISTRY.use_cases_explore_workflows.destination).toBe("/workflows");
    expect(CTA_REGISTRY.security_view_docs_security.destination).toBe("/docs/concepts/security-model");
    expect(CTA_REGISTRY.docs_start_quickstart.destination).toBe("/docs/quickstart");
    expect(CTA_REGISTRY.company_contact_team.destination).toBe("/contact#contact-form");
    expect(CTA_REGISTRY.global_footer_open_release_latest.destination).toBe(
      "https://github.com/freshtechbro/opendevbrowser/releases/latest"
    );
  });

  it("resolves CTA destinations through helper branches", () => {
    expect(resolveCtaDestination("global_top_nav_view_docs")).toBe("/docs");
    expect(resolveCtaDestination("docs_edit_on_github", "/docs/CLI.md")).toBe(
      "https://github.com/freshtechbro/opendevbrowser/edit/main/docs/CLI.md"
    );
    expect(resolveCtaDestination("docs_edit_on_github")).toBe(
      "https://github.com/freshtechbro/opendevbrowser/edit/main/docs/LANDING_PAGE_CONCEPT1_SPEC.md"
    );
  });
});

describe("frontend generated docs routing integrity", () => {
  it("ensures every docs manifest page has a generated page payload", () => {
    const manifest = loadJson<Manifest>("src/content/docs-manifest.json");
    const pages = loadJson<Pages>("src/content/docs-generated/pages.json");

    for (const category of manifest.categories) {
      for (const page of category.pages) {
        expect(pages.pages[`${category.slug}/${page.slug}`]).toBeDefined();
      }
    }
  });

  it("keeps category-root routes resolvable by index or first-page fallback", () => {
    const manifest = loadJson<Manifest>("src/content/docs-manifest.json");
    const pages = loadJson<Pages>("src/content/docs-generated/pages.json");

    for (const category of manifest.categories) {
      const indexKey = `${category.slug}/index`;
      const firstSlug = category.pages[0]?.slug;
      const fallbackKey = firstSlug ? `${category.slug}/${firstSlug}` : null;
      const hasCategoryRoot = Boolean(pages.pages[indexKey] ?? (fallbackKey ? pages.pages[fallbackKey] : null));
      expect(hasCategoryRoot).toBe(true);
    }
  });
});
