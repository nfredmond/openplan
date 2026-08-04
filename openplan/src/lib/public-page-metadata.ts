import type { Metadata } from "next";

/**
 * The origin this deployment serves itself from, or `undefined`.
 *
 * WHY THIS IS NOT A CONSTANT. It used to be a hardcoded literal naming one
 * specific Vercel instance (the founder's own deployment), and it feeds
 * `metadataBase` on the ROOT layout. Every deployment of OpenPlan
 * therefore emitted canonical and Open Graph URLs pointing at somebody else's
 * site: a county self-hosting this had its public engagement portal, its RTP
 * share links and every page it published attributed to another organisation.
 *
 * Returning `undefined` when nothing is configured is deliberate. Next.js then
 * infers the base from the platform (VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL)
 * or localhost in development — either of which is this deployment. Substituting
 * a known-wrong absolute origin is the one option that is never right.
 */
export function resolveSiteOrigin(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return undefined;

  const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  try {
    return new URL(withScheme);
  } catch {
    // A malformed value must not become the canonical origin of every page.
    return undefined;
  }
}
export const OPENPLAN_OG_IMAGE_PATH = "/openplan-og.svg";
export const OPENPLAN_SITE_NAME = "OpenPlan";

const defaultOgAlt =
  "OpenPlan: free, open-source planning software for agencies, tribes, counties, cities, and consultants.";

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
