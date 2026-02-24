import type { Metadata } from "next";

type MetadataInput = {
  title: string;
  description: string;
  path: string;
};

export function createRouteMetadata({ title, description, path }: MetadataInput): Metadata {
  const fullTitle = `${title} | OpenDevBrowser`;
  return {
    title: fullTitle,
    description,
    alternates: {
      canonical: path
    },
    openGraph: {
      title: fullTitle,
      description,
      type: "website",
      url: path,
      images: [
        {
          url: "/brand/social-og.png",
          width: 1200,
          height: 630,
          alt: "OpenDevBrowser social preview"
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: ["/brand/social-og.png"]
    }
  };
}
