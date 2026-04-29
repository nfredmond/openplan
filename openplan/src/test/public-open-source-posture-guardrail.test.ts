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
      /Apache-2\.0 planning software for agencies, tribes, RTPAs, counties, and consulting teams/i,
      /supports it through managed hosting, onboarding, planning services, and custom implementation work/i,
      /managed operations when you need someone accountable to run it/i,
    ],
  },
  {
    route: "/pricing",
    sourcePath: "src/app/(public)/pricing/page.tsx",
    requiredMarkers: [
      /Apache-2\.0 open-source software first/i,
      /earns revenue by operating hosted workspaces, onboarding teams, supporting planning workflows, and building custom extensions/i,
      /does not turn the open-source core into a proprietary software license/i,
      /not priced as a seat-based proprietary license/i,
    ],
  },
  {
    route: "/request-access",
    sourcePath: "src/app/(public)/request-access/page.tsx",
    requiredMarkers: [
      /self-hosting, managed-hosting, or implementation review/i,
      /not a live workspace, hosted subscription, or service commitment/i,
      /fits the current open-source product boundary/i,
      /Provision, invite, or scope services only after workspace ownership, data posture, billing, and support obligations are clear/i,
    ],
  },
  {
    route: "/legal",
    sourcePath: "src/app/(public)/legal/page.tsx",
    requiredMarkers: [
      /Open-source license boundary/i,
      /Managed hosting and services/i,
      /commercial terms cover managed hosting, onboarding, support, planning services, and custom implementation work around the open-source core/i,
      /Workspace activation, service scope, and billing are gated and reviewed individually/i,
    ],
  },
  {
    route: "/terms",
    sourcePath: "src/app/(public)/terms/page.tsx",
    requiredMarkers: [
      /Open-source software, hosted service when managed by Nat Ford/i,
      /do not replace the Apache-2\.0 license for self-hosted use of the open-source code/i,
      /Supervised managed hosting/i,
      /not a consumer analytics product and is not sold as one/i,
    ],
  },
  {
    route: "/examples",
    sourcePath: "src/app/(public)/examples/page.tsx",
    requiredMarkers: [
      /not a product tour and not a forecasting claim/i,
      /legal notice/i,
      /review service lanes/i,
      /request a supervised walk-through/i,
    ],
  },
];

const repositoryPostureSurfaces: PublicPostureSurface[] = [
  {
    route: "root README",
    sourcePath: "../README.md",
    requiredMarkers: [
      /Apache-2\.0 open-source planning software/i,
      /commercial model is services around the open-source core/i,
      /not intended to turn the Apache-2\.0 core into a closed source license/i,
      /should not be described as a finished autonomous municipal SaaS/i,
    ],
  },
  {
    route: "app README",
    sourcePath: "README.md",
    requiredMarkers: [
      /Apache-2\.0 open-source transportation and land-use planning software/i,
      /commercial model is services around the open-source core/i,
      /not a broad self-serve municipal SaaS/i,
      /serious Apache-2\.0 planning software with optional Nat Ford managed services/i,
    ],
  },
];

const subscriptionFirstClaimPatterns = [
  { label: "subscription-first positioning", pattern: /\bsubscription-first\b/i },
  { label: "SaaS-only positioning", pattern: /\bSaaS-only\b/i },
  { label: "self-serve SaaS launch claim", pattern: /\bself-serve\s+SaaS\b/i },
  { label: "automatic hosted-workspace creation", pattern: /workspace will be created automatically/i },
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
