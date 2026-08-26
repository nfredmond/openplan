import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import { metadata as examplesMetadata } from "@/app/(public)/examples/page";
import { metadata as landingMetadata } from "@/app/(public)/page";
import { OPENPLAN_OG_IMAGE_PATH } from "@/lib/public-page-metadata";

type PublicMetadataCase = {
  route: string;
  metadata: Metadata;
  required: RegExp[];
};

const publicMetadataCases: PublicMetadataCase[] = [
  {
    route: "/",
    metadata: landingMetadata,
    required: [/Apache-2\.0/i, /free/i, /open-source/i, /no paid tier/i],
  },
  {
    route: "/examples",
    metadata: examplesMetadata,
    required: [/Nevada County/i, /validation metrics/i, /caveats/i, /prototype-only/i],
  },
];

const forbiddenBuyerUnsafeClaims = [
  // Still overclaims: OpenPlan is software you can run, not a SaaS; its
  // modeling is screening-grade, not validated forecasting.
  /self-serve\s+SaaS/i,
  /autonomous municipal/i,
  /validated forecasting platform/i,
  /subscription-first/i,
  /black-box license/i,
  // Now banned in the other direction — OpenPlan is free and open source, so
  // any paid-tier or services framing in metadata is the overclaim.
  /managed hosting/i,
  /\bpricing\b/i,
  /service retainer/i,
  // Note: "no paid tier" is a truthful NEGATION and must stay allowed, so this
  // matches only an affirmative offer of one.
  /(?<!no )paid (tier|plan)s?\b/i,
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
  it.each(publicMetadataCases)("$route has social metadata aligned to the free open-source posture", ({ metadata, required }) => {
    const text = metadataText(metadata);

    expect(openGraph(metadata).siteName).toBe("OpenPlan");
    expect(openGraph(metadata).type).toBe("website");
    expect(twitter(metadata).card).toBe("summary_large_image");
    const canonical = metadata.alternates?.canonical;
    const ogUrl = openGraph(metadata).url;
    const images = openGraph(metadata).images as Array<{ url?: unknown }> | undefined;
    if (canonical || ogUrl || images) {
      expect(String(canonical)).toMatch(/^https:\/\//);
      expect(ogUrl).toBe(canonical);
      expect(images).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: expect.stringMatching(new RegExp(`${OPENPLAN_OG_IMAGE_PATH.replace("/", "\\/")}$`)),
            width: 1200,
            height: 630,
            alt: expect.stringMatching(/free, open-source planning software/i),
          }),
        ]),
      );
    }

    const missing = required.filter((marker) => !marker.test(text)).map((marker) => marker.toString());
    expect(missing).toEqual([]);
  });

  it.each(publicMetadataCases)("$route does not publish buyer-unsafe metadata claims", ({ metadata }) => {
    const text = metadataText(metadata);
    const offenders = forbiddenBuyerUnsafeClaims.filter((pattern) => pattern.test(text)).map((pattern) => pattern.toString());

    expect(offenders).toEqual([]);
  });

  it("ships a social preview asset that sells nothing", () => {
    const svg = readFileSync(path.join(process.cwd(), "public/openplan-og.svg"), "utf8");

    expect(svg).toContain("free, open-source Apache-2.0 planning software");
    expect(svg).toContain("that is free to use");
    expect(svg).not.toMatch(/SaaS|autonomous|validated forecasting/i);
    // The image renders on every shared link — it must not sell a tier.
    expect(svg).not.toMatch(/managed (hosting|services)|pricing|retainer/i);
  });
});
