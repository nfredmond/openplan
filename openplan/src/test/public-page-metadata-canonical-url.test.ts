import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildOpenPlanPublicMetadata,
  OPENPLAN_OG_IMAGE_PATH,
  OPENPLAN_SITE_NAME,
  resolveSiteOrigin,
} from "@/lib/public-page-metadata";

/**
 * CORRECTED, not updated.
 *
 * This file previously asserted `OPENPLAN_CANONICAL_ORIGIN` equals
 * "https://openplan-natford.vercel.app" — one specific Vercel instance — and
 * called it "the live production alias". That described the code rather than
 * the intent, and the code was wrong: the constant feeds `metadataBase` on the
 * ROOT layout, so every deployment of OpenPlan emitted canonical and Open Graph
 * URLs pointing at somebody else's site. A county self-hosting this had its
 * public engagement portal and every RTP share link attributed to another
 * organisation.
 */

const FOUNDER_DEPLOYMENT = "https://openplan-natford.vercel.app";

describe("site origin resolution", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_VERCEL_PRODUCTION = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
    if (ORIGINAL_VERCEL_PRODUCTION === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = ORIGINAL_VERCEL_PRODUCTION;
    if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  });

  it("is undefined when a self-hosted deployment has not configured its public origin", () => {
    expect(resolveSiteOrigin()).toBeUndefined();
  });

  it("never falls back to any particular deployment", () => {
    expect(resolveSiteOrigin()?.origin).not.toBe(FOUNDER_DEPLOYMENT);
  });

  it("uses the operator's configured origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://plan.nevadacountyca.gov";
    expect(resolveSiteOrigin()?.origin).toBe("https://plan.nevadacountyca.gov");
  });

  it("accepts a bare host and assumes https", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "plan.nevadacountyca.gov";
    expect(resolveSiteOrigin()?.origin).toBe("https://plan.nevadacountyca.gov");
  });

  it("uses Vercel's production host when no public alias is configured", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "openplan-agency.vercel.app";
    expect(resolveSiteOrigin()?.origin).toBe("https://openplan-agency.vercel.app");
  });

  it("returns undefined for a malformed value rather than making it canonical", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://";
    expect(resolveSiteOrigin()).toBeUndefined();
  });

  it("ignores whitespace-only configuration", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect(resolveSiteOrigin()).toBeUndefined();
  });
});

describe("OpenPlan public metadata", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_VERCEL_PRODUCTION = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
    if (ORIGINAL_VERCEL_PRODUCTION === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = ORIGINAL_VERCEL_PRODUCTION;
    if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  });

  it("generates absolute canonical and social URLs from the configured public application URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://plan.nevadacountyca.gov";
    const metadata = buildOpenPlanPublicMetadata({
      title: "OpenPlan Examples",
      description: "Inspectable planning workflows and proof packets.",
      path: "/examples",
    });

    expect(metadata.alternates?.canonical).toBe("https://plan.nevadacountyca.gov/examples");
    expect(metadata.openGraph?.url).toBe("https://plan.nevadacountyca.gov/examples");
    expect(metadata.openGraph?.siteName).toBe(OPENPLAN_SITE_NAME);
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: `https://plan.nevadacountyca.gov${OPENPLAN_OG_IMAGE_PATH}` }),
    ]);
    expect(metadata.twitter?.images).toEqual([`https://plan.nevadacountyca.gov${OPENPLAN_OG_IMAGE_PATH}`]);
  });

  it("omits unsupported URLs instead of emitting relative values that Next resolves to localhost", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    const metadata = buildOpenPlanPublicMetadata({
      title: "OpenPlan Examples",
      description: "Inspectable planning workflows and proof packets.",
      path: "/examples",
    });

    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter?.images).toBeUndefined();
  });
});
