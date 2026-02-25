import pagesData from "@/content/docs-generated/pages.json";
import manifestData from "@/content/docs-manifest.json";
import type { DocPageEntry, DocsManifest } from "@/lib/docs/types";

const typedManifest = manifestData as DocsManifest;
const typedPages = pagesData as { generatedAt: string; pages: Record<string, DocPageEntry> };

function withoutEmDash(input: string): string {
  return input.replace(/—/g, "-");
}

function normalizeDocPage(page: DocPageEntry | null): DocPageEntry | null {
  if (!page) return null;
  return {
    ...page,
    title: withoutEmDash(page.title),
    summary: withoutEmDash(page.summary),
    contentHtml: withoutEmDash(page.contentHtml),
    codeSample: withoutEmDash(page.codeSample)
  };
}

export function getDocsManifest(): DocsManifest {
  return {
    ...typedManifest,
    categories: typedManifest.categories.map((category) => ({
      ...category,
      title: withoutEmDash(category.title),
      pages: category.pages.map((page) => ({
        ...page,
        title: withoutEmDash(page.title)
      }))
    }))
  };
}

export function getDocPage(category: string, slug: string): DocPageEntry | null {
  return normalizeDocPage(typedPages.pages[`${category}/${slug}`] ?? null);
}

export function getDocCategoryRoot(category: string): DocPageEntry | null {
  const indexPage = typedPages.pages[`${category}/index`] ?? null;
  if (indexPage) {
    return normalizeDocPage(indexPage);
  }

  const categoryEntry = typedManifest.categories.find((entry) => entry.slug === category);
  const firstPageSlug = categoryEntry?.pages[0]?.slug;
  if (!firstPageSlug) {
    return null;
  }

  return normalizeDocPage(typedPages.pages[`${category}/${firstPageSlug}`] ?? null);
}

export function listDocsCategories() {
  return getDocsManifest().categories;
}
