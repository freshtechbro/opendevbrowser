export type DocPageEntry = {
  category: string;
  slug: string;
  title: string;
  summary: string;
  sourcePath: string;
  editUrl: string;
  contentHtml: string;
  codeSample: string;
};

export type DocsManifestPage = {
  slug: string;
  title: string;
  route: string;
  sourcePath: string;
};

export type DocsManifestCategory = {
  slug: string;
  title: string;
  pages: DocsManifestPage[];
};

export type DocsManifest = {
  generatedAt: string;
  categories: DocsManifestCategory[];
};
