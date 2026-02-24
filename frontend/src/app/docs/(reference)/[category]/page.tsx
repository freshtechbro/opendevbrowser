import { notFound } from "next/navigation";
import { DocsPage } from "@/components/docs/docs-page";
import { getDocCategoryRoot } from "@/lib/docs/content";

type Params = { category: string };

function formatCategory(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function DocsCategoryRootPage({ params }: { params: Promise<Params> }) {
  const { category } = await params;
  const page = getDocCategoryRoot(category);
  if (!page) {
    notFound();
  }

  return <DocsPage page={page} breadcrumb={`docs / ${formatCategory(category)}`} />;
}
