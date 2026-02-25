import { CtaLink } from "@/components/shared/cta-link";
import type { DocPageEntry } from "@/lib/docs/types";

type DocsPageProps = {
  page: DocPageEntry;
  breadcrumb?: string;
};

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function DocsPage({ page, breadcrumb }: DocsPageProps) {
  const fallbackBreadcrumb = `docs / ${formatLabel(page.category)} / ${page.title}`;

  return (
    <article className="docs-content-inner">
      <p className="docs-breadcrumb">{breadcrumb ?? fallbackBreadcrumb}</p>
      <header>
        <h1>{page.title}</h1>
        <p>{page.summary}</p>
      </header>
      <div className="docs-actions">
        <CtaLink ctaId="docs_edit_on_github" className="btn btn-secondary" sourcePath={page.sourcePath}>
          Edit source
        </CtaLink>
        <a className="btn btn-secondary" href={page.editUrl} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </div>
      <section className="card" dangerouslySetInnerHTML={{ __html: page.contentHtml }} />
      <article className="terminal">
        <div className="terminal-head">
          <span className="dot r" />
          <span className="dot y" />
          <span className="dot g" />
          <span className="terminal-title">command example</span>
        </div>
        <pre>{page.codeSample}</pre>
      </article>
    </article>
  );
}
