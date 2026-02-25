export type CtaScope =
  | "home"
  | "product"
  | "use-cases"
  | "workflows"
  | "security"
  | "open-source"
  | "docs"
  | "resources"
  | "company"
  | "global";

export type CtaId =
  | "home_get_started_quickstart"
  | "product_read_docs"
  | "use_cases_explore_workflows"
  | "use_cases_view_annotation"
  | "workflows_start_quickstart"
  | "security_view_docs_security"
  | "open_source_view_latest_release"
  | "open_source_view_github_repo"
  | "docs_start_quickstart"
  | "docs_edit_on_github"
  | "resources_view_changelog"
  | "company_contact_team"
  | "global_top_nav_get_started"
  | "global_top_nav_view_docs"
  | "global_top_nav_open_release_latest"
  | "global_footer_open_release_latest"
  | "global_footer_view_readme"
  | "global_sticky_get_started"
  | "global_sticky_download_latest_release";

export type CtaEntry = {
  ctaId: CtaId;
  sectionId: `${CtaScope}::${string}`;
  destination: string;
};

export const CTA_REGISTRY: Record<CtaId, CtaEntry> = {
  home_get_started_quickstart: {
    ctaId: "home_get_started_quickstart",
    sectionId: "home::hero",
    destination: "/docs/quickstart"
  },
  product_read_docs: {
    ctaId: "product_read_docs",
    sectionId: "product::hero",
    destination: "/docs"
  },
  use_cases_explore_workflows: {
    ctaId: "use_cases_explore_workflows",
    sectionId: "use-cases::hero",
    destination: "/workflows"
  },
  use_cases_view_annotation: {
    ctaId: "use_cases_view_annotation",
    sectionId: "use-cases::annotation",
    destination: "/docs#annotation"
  },
  workflows_start_quickstart: {
    ctaId: "workflows_start_quickstart",
    sectionId: "workflows::hero",
    destination: "/docs/quickstart"
  },
  security_view_docs_security: {
    ctaId: "security_view_docs_security",
    sectionId: "security::hero",
    destination: "/docs/concepts/security-model"
  },
  open_source_view_latest_release: {
    ctaId: "open_source_view_latest_release",
    sectionId: "open-source::release-panel",
    destination: "https://github.com/freshtechbro/opendevbrowser/releases/latest"
  },
  open_source_view_github_repo: {
    ctaId: "open_source_view_github_repo",
    sectionId: "open-source::cta-row",
    destination: "https://github.com/freshtechbro/opendevbrowser"
  },
  docs_start_quickstart: {
    ctaId: "docs_start_quickstart",
    sectionId: "docs::hero",
    destination: "/docs/quickstart"
  },
  docs_edit_on_github: {
    ctaId: "docs_edit_on_github",
    sectionId: "docs::content-header",
    destination: "https://github.com/freshtechbro/opendevbrowser/edit/main/{source_path}"
  },
  resources_view_changelog: {
    ctaId: "resources_view_changelog",
    sectionId: "resources::hero",
    destination: "/resources#changelog"
  },
  company_contact_team: {
    ctaId: "company_contact_team",
    sectionId: "company::contact",
    destination: "/contact#contact-form"
  },
  global_top_nav_get_started: {
    ctaId: "global_top_nav_get_started",
    sectionId: "global::top-nav",
    destination: "/docs/quickstart"
  },
  global_top_nav_view_docs: {
    ctaId: "global_top_nav_view_docs",
    sectionId: "global::top-nav",
    destination: "/docs"
  },
  global_top_nav_open_release_latest: {
    ctaId: "global_top_nav_open_release_latest",
    sectionId: "global::top-nav",
    destination: "https://github.com/freshtechbro/opendevbrowser/releases/latest"
  },
  global_footer_open_release_latest: {
    ctaId: "global_footer_open_release_latest",
    sectionId: "global::footer",
    destination: "https://github.com/freshtechbro/opendevbrowser/releases/latest"
  },
  global_footer_view_readme: {
    ctaId: "global_footer_view_readme",
    sectionId: "global::footer",
    destination: "https://github.com/freshtechbro/opendevbrowser#readme"
  },
  global_sticky_get_started: {
    ctaId: "global_sticky_get_started",
    sectionId: "global::sticky-cta",
    destination: "/docs/quickstart"
  },
  global_sticky_download_latest_release: {
    ctaId: "global_sticky_download_latest_release",
    sectionId: "global::sticky-cta",
    destination: "https://github.com/freshtechbro/opendevbrowser/releases/latest"
  }
};

export function resolveCtaDestination(ctaId: CtaId, sourcePath?: string): string {
  const entry = CTA_REGISTRY[ctaId];
  if (ctaId !== "docs_edit_on_github") {
    return entry.destination;
  }
  const safeSource = sourcePath ? sourcePath.replace(/^\/+/, "") : "docs/LANDING_PAGE_CONCEPT1_SPEC.md";
  return entry.destination.replace("{source_path}", safeSource);
}
