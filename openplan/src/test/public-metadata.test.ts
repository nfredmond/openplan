import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import { metadata as examplesMetadata } from "@/app/(public)/examples/page";
import { metadata as landingMetadata } from "@/app/(public)/page";
import { metadata as pricingMetadata } from "@/app/(public)/pricing/page";
import { metadata as requestAccessMetadata } from "@/app/(public)/request-access/page";
import { OPENPLAN_OG_IMAGE_PATH } from "@/lib/public-page-metadata";

type PublicMetadataCase = {
  route: string;
  metadata: Metadata;
  canonical: string;
  required: RegExp[];
};

const publicMetadataCases: PublicMetadataCase[] = [
  {
    route: "/",
    metadata: landingMetadata,
    canonical: "/",
    required: [/Apache-2\.0/i, /managed hosting/i, /onboarding/i, /support/i, /implementation/i],
  },
  {
    route: "/pricing",
    metadata: pricingMetadata,
    canonical: "/pricing",
    required: [/self-hosting/i, /managed hosting/i, /planning services/i, /Apache-2\.0 core/i],
  },
  {
    route: "/examples",
    metadata: examplesMetadata,
    canonical: "/examples",
    required: [/Nevada County/i, /validation metrics/i, /caveats/i, /prototype-only/i, /buyer-safe/i],
  },
  {
    route: "/request-access",
    metadata: requestAccessMetadata,
    canonical: "/request-access",
    required: [/reviewed OpenPlan intake/i, /self-hosting/i, /managed hosting/i, /no automatic workspace or billing/i],
  },
];

const forbiddenBuyerUnsafeClaims = [
  /self-serve\s+SaaS/i,
  /autonomous municipal/i,
  /validated forecasting platform/i,
  /workspace will be created automatically/i,
  /subscription-first/i,
  /black-box license/i,
];

function metadataText(metadata: Metadata) {
  return JSON.stringify(metadata);
}

function openGraph(metadata: Metadata) {
  return (metadata.openGraph ?? {}) as Record<string, unknown>;
}

function twitter(metadata: Metadata) {
  return (metadata.twitter ?? {}) as Record<string, unknown>;
}

describe("public route metadata", () => {
  it.each(publicMetadataCases)("$route has canonical, OG, and Twitter metadata aligned to the open-source services posture", ({ metadata, canonical, required }) => {
    const text = metadataText(metadata);

    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(openGraph(metadata).url).toBe(canonical);
    expect(openGraph(metadata).siteName).toBe("OpenPlan");
    expect(openGraph(metadata).type).toBe("website");
    expect(openGraph(metadata).images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: OPENPLAN_OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: expect.stringMatching(/Apache-2\.0 planning software/i),
        }),
      ])
    );
    expect(twitter(metadata).card).toBe("summary_large_image");
    expect(twitter(metadata).images).toContain(OPENPLAN_OG_IMAGE_PATH);

    const missing = required.filter((marker) => !marker.test(text)).map((marker) => marker.toString());
    expect(missing).toEqual([]);
  });

  it.each(publicMetadataCases)("$route does not publish buyer-unsafe metadata claims", ({ metadata }) => {
    const text = metadataText(metadata);
    const offenders = forbiddenBuyerUnsafeClaims.filter((pattern) => pattern.test(text)).map((pattern) => pattern.toString());

    expect(offenders).toEqual([]);
  });

  it("ships a durable OpenPlan social preview asset with restrained service-language", () => {
    const svg = readFileSync(path.join(process.cwd(), "public/openplan-og.svg"), "utf8");

    expect(svg).toContain("Apache-2.0 planning software");
    expect(svg).toContain("managed hosting, support, and implementation services");
    expect(svg).toContain("Apache-2.0 core");
    expect(svg).not.toMatch(/SaaS|autonomous|validated forecasting/i);
  });
});
