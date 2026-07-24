import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PublicPostureSurface = {
  route: string;
  sourcePath: string;
  requiredMarkers: RegExp[];
};

const publicPostureSurfaces: PublicPostureSurface[] = [
  {
    route: "/",
    sourcePath: "src/app/(public)/page.tsx",
    requiredMarkers: [
      /Open-source planning software that keeps maps, engagement, and delivery in one record/i,
      /free, Apache-2\.0 planning software for agencies, tribes, RTPAs, counties/i,
      /no plans, no seats, no usage quotas, and no payment step/i,
      /Proof path for the Apache-2\.0 claim/i,
      /https:\/\/github\.com\/nfredmond\/openplan\/blob\/main\/LICENSE/i,
    ],
  },
  {
    route: "/legal",
    sourcePath: "src/app/(public)/legal/page.tsx",
    requiredMarkers: [
      /Open-source license boundary/i,
      /No paid tier/i,
      /free to use and free to self-host/i,
      /no feature is withheld pending an upgrade/i,
    ],
  },
  {
    route: "/terms",
    sourcePath: "src/app/(public)/terms/page.tsx",
    requiredMarkers: [
      /Apache-2\.0 software, free to use and to self-host/i,
      /do not replace or narrow the Apache-2\.0 license/i,
      /No paid tier, no gated features/i,
      /not a consumer analytics product and is not sold as one/i,
    ],
  },
  {
    route: "/examples",
    sourcePath: "src/app/(public)/examples/page.tsx",
    requiredMarkers: [
      /not a product tour and not a forecasting claim/i,
      /legal notice/i,
      /Create your free workspace/i,
    ],
  },
];

const repositoryPostureSurfaces: PublicPostureSurface[] = [
  {
    route: "root README",
    sourcePath: "../README.md",
    requiredMarkers: [
      /Apache-2\.0 open-source planning software/i,
      /OpenPlan is free\./i,
      /no paid tier, no plan, no seat count, no usage quota, and no payment step/i,
      /There is no Stripe or\s+billing integration in the codebase/i,
    ],
  },
  {
    route: "app README",
    sourcePath: "README.md",
    requiredMarkers: [
      /Apache-2\.0 open-source transportation and land-use planning software/i,
      /OpenPlan is free\./i,
      /self-serve and free/i,
    ],
  },
];

const subscriptionFirstClaimPatterns = [
  { label: "pricing route link", pattern: /href="\/pricing/i },
  { label: "request-access route link", pattern: /href="\/request-access/i },
  { label: "managed hosting offer", pattern: /managed hosting/i },
  { label: "service lane framing", pattern: /service lanes?\b/i },
  { label: "subscription-first positioning", pattern: /\bsubscription-first\b/i },
  { label: "SaaS-only positioning", pattern: /\bSaaS-only\b/i },
  { label: "self-serve SaaS launch claim", pattern: /\bself-serve\s+SaaS\b/i },
  { label: "direct Starter/Professional account CTA", pattern: /Create (?:Starter|Professional) account/i },
  { label: "direct subscription CTA", pattern: /\b(?:Subscribe now|Start (?:your )?subscription|Choose a subscription)\b/i },
  { label: "seat-license purchase CTA", pattern: /\b(?:Buy|Purchase) (?:a )?(?:seat|software license)\b/i },
];

function readPublicSurfaceSource(surface: PublicPostureSurface) {
  return readFileSync(path.join(process.cwd(), surface.sourcePath), "utf8").replace(/\s+/g, " ");
}

describe("public open-source posture guardrail", () => {
  it.each(publicPostureSurfaces)("$route keeps the current open-source/services boundary markers", (surface) => {
    const source = readPublicSurfaceSource(surface);
    const missingMarkers = surface.requiredMarkers
      .filter((marker) => !marker.test(source))
      .map((marker) => marker.toString());

    expect(missingMarkers).toEqual([]);
  });

  it.each(publicPostureSurfaces)("does not reintroduce subscription-first SaaS claims on $route", (surface) => {
    const source = readPublicSurfaceSource(surface);
    const offenders = subscriptionFirstClaimPatterns
      .filter(({ pattern }) => pattern.test(source))
      .map(({ label }) => label);

    expect(offenders).toEqual([]);
  });

  it.each(repositoryPostureSurfaces)("$route keeps repository-level posture markers", (surface) => {
    const source = readPublicSurfaceSource(surface);
    const missingMarkers = surface.requiredMarkers
      .filter((marker) => !marker.test(source))
      .map((marker) => marker.toString());

    expect(missingMarkers).toEqual([]);
  });
});
