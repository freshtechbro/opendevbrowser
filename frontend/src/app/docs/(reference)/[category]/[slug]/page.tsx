import { notFound } from "next/navigation";
import { DocsPage } from "@/components/docs/docs-page";
import { getDocPage } from "@/lib/docs/content";

type Params = { category: string; slug: string };

export default async function DocsCategoryPage({ params }: { params: Promise<Params> }) {
  const { category, slug } = await params;
  const page = getDocPage(category, slug);
  if (!page) {
    notFound();
  }

  return <DocsPage page={page} />;
}
