import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPublicPortalBundleMock = vi.fn();

vi.mock("@/lib/engagement/public-portal-data", () => ({
  loadPublicPortalBundle: (...args: unknown[]) => loadPublicPortalBundleMock(...args),
}));

import { generateMetadata } from "@/app/(public)/engage/[shareToken]/page";

/**
 * THE LINK PREVIEW IS A PUBLIC SURFACE, AND IT WAS SHOWING OPERATOR TEXT.
 *
 * `engagement_campaigns` carries two descriptions that are deliberately not the
 * same thing. The campaign form labels one "Public-facing description — shown on
 * portal page", and asks for the other with "What kind of input is this campaign
 * collecting, and how will operators use it?" An operator answering that second
 * question honestly writes internal framing — which grant the comments support,
 * how the input will be used, who is being targeted for outreach.
 *
 * The portal BODY renders `publicDescription` and only falls back to `summary`.
 * `generateMetadata` read `summary` alone and never looked at
 * `publicDescription` at all — so the meta description and og:description, which
 * are what a search engine indexes and what renders when a resident shares the
 * link into a neighbourhood group, carried the operator's note while the page
 * itself showed the resident-facing copy.
 *
 * Found in the browser on 2026-08-08: a campaign whose public description was
 * plain outreach copy still previewed with the operator summary naming the
 * funding programme behind the study.
 *
 * The contract asserted here is the durable one — THE PREVIEW SAYS WHAT THE PAGE
 * SAYS — rather than "reads column X", because it stays true if the fields are
 * renamed or a third is added.
 */

type TextValue = { text: string } | null;

function bundleWith(publicDescription: TextValue, summary: TextValue) {
  return {
    campaignText: {
      title: { text: "East Main Street Safety" },
      publicDescription,
      summary,
    },
    locale: { source: "default", locale: "en" },
    // The real translator reads both of these; a thinner fake throws inside it
    // and the test would fail for a reason that has nothing to do with the
    // contract being asserted.
    messages: { messages: {}, fallbackKeys: [] },
  };
}

const PUBLIC_COPY = "Tell us where crossing East Main feels unsafe.";
const OPERATOR_NOTE = "Comments to justify the SS4A ask; target the neighbourhood association.";

async function descriptionFor(bundle: unknown) {
  loadPublicPortalBundleMock.mockResolvedValue(bundle);
  const metadata = await generateMetadata({
    params: Promise.resolve({ shareToken: "tok" }),
  });
  return metadata.description;
}

describe("public portal link preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews the public description, not the operator summary", async () => {
    const description = await descriptionFor(
      bundleWith({ text: PUBLIC_COPY }, { text: OPERATOR_NOTE })
    );

    expect(description).toBe(PUBLIC_COPY);
    expect(description).not.toContain("SS4A");
  });

  it("never leaks the operator summary into og:description either", async () => {
    loadPublicPortalBundleMock.mockResolvedValue(
      bundleWith({ text: PUBLIC_COPY }, { text: OPERATOR_NOTE })
    );

    const metadata = await generateMetadata({ params: Promise.resolve({ shareToken: "tok" }) });

    // openGraph carries its own copy of the description; fixing one and not the
    // other would leave the share-to-social path — the most public one — broken.
    expect(JSON.stringify(metadata.openGraph ?? {})).not.toContain("SS4A");
  });

  /**
   * The body keeps this fallback, so the preview keeps it too: the two must not
   * disagree. A campaign that has passed its own share-readiness checks has a
   * public description and never reaches it.
   */
  it("falls back to the summary only when there is no public description", async () => {
    const description = await descriptionFor(bundleWith(null, { text: OPERATOR_NOTE }));

    expect(description).toBe(OPERATOR_NOTE);
  });

  it("does not index a portal it could not load", async () => {
    loadPublicPortalBundleMock.mockResolvedValue(null);

    const metadata = await generateMetadata({ params: Promise.resolve({ shareToken: "nope" }) });

    expect(metadata.robots).toMatchObject({ index: false });
  });
});
