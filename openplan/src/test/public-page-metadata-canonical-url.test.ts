import { describe, expect, it } from "vitest";
import {
  buildOpenPlanPublicMetadata,
  OPENPLAN_CANONICAL_ORIGIN,
  OPENPLAN_OG_IMAGE_PATH,
  OPENPLAN_SITE_NAME,
} from "@/lib/public-page-metadata";

const UNRESOLVED_CUSTOM_DOMAIN = "https://openplan.natfordplanning.com";

describe("OpenPlan public metadata canonical URL", () => {
  it("uses the live Vercel production alias as the canonical origin", () => {
    expect(OPENPLAN_CANONICAL_ORIGIN).toBe("https://openplan-natford.vercel.app");
    expect(OPENPLAN_CANONICAL_ORIGIN).not.toBe(UNRESOLVED_CUSTOM_DOMAIN);
  });

  it("keeps page metadata path-relative under the configured canonical origin", () => {
    const metadata = buildOpenPlanPublicMetadata({
      title: "OpenPlan Examples",
      description: "Inspectable planning workflows and proof packets.",
      path: "/examples",
    });

    expect(metadata.alternates?.canonical).toBe("/examples");
    expect(metadata.openGraph?.url).toBe("/examples");
    expect(metadata.openGraph?.siteName).toBe(OPENPLAN_SITE_NAME);
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: OPENPLAN_OG_IMAGE_PATH }),
    ]);
  });
});
