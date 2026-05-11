import type { Metadata } from "next";

export const OPENPLAN_CANONICAL_ORIGIN = "https://openplan-natford.vercel.app";
export const OPENPLAN_OG_IMAGE_PATH = "/openplan-og.svg";
export const OPENPLAN_SITE_NAME = "OpenPlan";

const defaultOgAlt =
  "OpenPlan: Apache-2.0 planning software with optional Nat Ford managed hosting, support, and implementation services.";

type PublicPageMetadataInput = {
  title: string;
  description: string;
  path: `/${string}`;
  imageAlt?: string;
};

export function buildOpenPlanPublicMetadata({
  title,
  description,
  path,
  imageAlt = defaultOgAlt,
}: PublicPageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: OPENPLAN_SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [
        {
          url: OPENPLAN_OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OPENPLAN_OG_IMAGE_PATH],
    },
  };
}
