import type { ReactNode } from "react";
import { DocsShell } from "@/components/docs/docs-shell";
import { getDocsManifest } from "@/lib/docs/content";

export default function DocsReferenceLayout({ children }: { children: ReactNode }) {
  const manifest = getDocsManifest();
  return <DocsShell manifest={manifest}>{children}</DocsShell>;
}
