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
 * Vercel supplies its own deployment host when the operator has not set the
 * public alias. Other self-hosted deployments must configure the value. When
 * none can be established, callers omit canonical and social asset URLs rather
 * than asking Next.js to guess localhost.
 */
export function resolveSiteOrigin(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const platformHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  const candidate = configured || platformHost;
  if (!candidate) return undefined;

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
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
  const origin = resolveSiteOrigin();
  const canonicalUrl = origin ? new URL(path, origin).toString() : null;
  const imageUrl = origin ? new URL(OPENPLAN_OG_IMAGE_PATH, origin).toString() : null;

  return {
    title,
    description,
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
    openGraph: {
      title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      siteName: OPENPLAN_SITE_NAME,
      type: "website",
      locale: "en_US",
      ...(imageUrl
        ? {
            images: [
              {
                url: imageUrl,
                width: 1200,
                height: 630,
                alt: imageAlt,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}
