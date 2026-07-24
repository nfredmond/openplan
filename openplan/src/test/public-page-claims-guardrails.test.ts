import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Public-page claim guard.
 *
 * POSTURE FLIP (2026-07-23). OpenPlan is self-serve, free, and open source. The
 * earlier "request-access / founder fit-review / not self-serve" posture was
 * introduced unintentionally and is reversed (see CLAUDE.md). This guard was
 * rewritten in step with the public pages — per the sequencing rule, the
 * capability landed first (sign-up + auto-provisioned workspace, teammate
 * invites, password recovery), then the claims changed, then this guard was
 * rewritten to assert the NEW truth. It was NOT deleted: a module with no claim
 * guard is how overclaiming comes back, now pointing the other way.
 *
 * Two things this still guards, because they remain true and must not be
 * overclaimed:
 *   1. The modeling is screening-grade. No calibrated/validated forecasting,
 *      no grant-award prediction, no autonomous planning.
 *   2. The product is FREE. There is no paid tier and no checkout, so a
 *      subscription/checkout CTA is still prohibited — not because access is
 *      gated, but because nothing charges the user.
 *
 * `sales-proof-claim-boundaries.test.ts` is deliberately untouched: it guards
 * DATED proof documents in docs/, which were accurate as of their date. Editing
 * a dated record to match today's posture would falsify it.
 */

const PUBLIC_PAGE_FILES = [
  "src/app/(public)/page.tsx",
  "src/app/(public)/pricing/page.tsx",
  "src/app/(public)/examples/page.tsx",
  "src/app/(public)/request-access/page.tsx",
  "src/app/(public)/contact/page.tsx",
  "src/app/(public)/contact/openplan-fit/page.tsx",
  "src/app/(public)/legal/page.tsx",
  "src/app/(public)/privacy/page.tsx",
  "src/app/(public)/terms/page.tsx",
] as const;

/** The front door: hero + header CTAs must lead with self-serve sign-up. */
const LANDING_PAGE = "src/app/(public)/page.tsx";
const PUBLIC_LAYOUT = "src/app/(public)/layout.tsx";

const PROHIBITED_PUBLIC_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  // Still prohibited — the product is free, so there is nothing to buy. This
  // enforces "no payment step", not "no self-serve".
  {
    label: "paid subscription or checkout CTA (product is free)",
    pattern: /\b(?:subscribe now|start(?: your)? subscription|start(?: your)? free trial|buy now|checkout now|launch checkout|create (?:starter|professional|paid) account|activate(?: your)? subscription|enter (?:card|payment)|billing required)\b/i,
  },
  // The modeling honesty boundary is unchanged: screening-grade only.
  {
    label: "autonomous grant, legal, or compliance work",
    pattern: /\bautonomous\b.{0,80}\b(?:grant|legal|lapm|compliance|permitting|approval|decision|award|application)\b/i,
  },
  {
    label: "legal-grade or compliance-grade automation",
    pattern: /\b(?:legal|lapm|compliance|regulatory)[- ]grade\b.{0,80}\b(?:automation|approval|certification|review|sign[- ]off|determination)\b/i,
  },
  {
    label: "guaranteed grant award or funding outcome",
    pattern: /\b(?:guarantee(?:d|s)?|ensure(?:s|d)?|promise(?:s|d)?|will win|win more)\b.{0,80}\b(?:grant|award|funding|reimbursement|allocation)\b/i,
  },
  {
    label: "validated award or ridership prediction claim",
    pattern: /\b(?:predict(?:s|ed|ion)?|forecast(?:s|ed)?|score(?:s|d)?)\b.{0,80}\b(?:award likelihood|grant success|funding outcome|reimbursement approval|ridership|traffic volume|vmt)\b/i,
  },
  {
    label: "calibrated or validated forecasting availability",
    pattern: /\b(?:calibrated|validated|certified|planning[- ]grade)\b.{0,80}\b(?:forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)\b.{0,80}\b(?:ready|available|supported|provided|included|delivered|built in|built-in)\b/i,
  },
  {
    label: "forecasting accuracy or calibration proof",
    pattern: /\b(?:proves?|guarantees?|certifies?|validates?)\b.{0,80}\b(?:forecast(?:ing)? accuracy|model calibration|traffic volume forecast|ridership forecast|vmt forecast)\b/i,
  },
];

function publicPageSource(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function sourceWithoutExplicitCaveats(source: string) {
  return source
    .replace(/[^.\n]*(?:no|not|never|without|do not|does not|cannot|isn[’']t|aren[’']t)[^.\n]*\b(?:calibrated|validated|certified|planning[- ]grade|forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)[^.\n]*/gi, "")
    .replace(/[^.\n]*\b(?:screening[- ]grade|prototype[- ]only|internal prototype only|caveat|supervised review|qualified reviewer)[^.\n]*\b(?:calibrated|validated|certified|planning[- ]grade|forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)[^.\n]*/gi, "");
}

describe("public page claims guardrails", () => {
  it.each(PUBLIC_PAGE_FILES)("keeps %s out of paid-checkout and modeling overclaim posture", (file) => {
    const source = sourceWithoutExplicitCaveats(publicPageSource(file));

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(source, `${file} contains prohibited public claim: ${label}`).not.toMatch(pattern);
    }
  });

  it("leads the front door with self-serve sign-up, not a founder access queue", () => {
    const landing = publicPageSource(LANDING_PAGE);
    const layout = publicPageSource(PUBLIC_LAYOUT);

    // The hero and header must offer real sign-up.
    expect(landing).toMatch(/\/sign-up/);
    expect(layout).toMatch(/\/sign-up/);
    // And state the posture plainly: free, immediate, no gate.
    expect(landing).toMatch(/free/i);
    expect(landing).toMatch(/immediately|no access queue|no founder|ready immediately/i);

    // The front door must NOT route software access through the request-access
    // queue. (The /request-access page may still exist for services inquiries —
    // this asserts the LANDING hero and header do not lead with it.)
    expect(landing).not.toMatch(/href="\/request-access[^"]*"\s+className="public-primary-link"/);
    expect(layout).not.toMatch(/href="\/request-access"/);
  });

  it("does not reinstate a founder gate as the way to reach the software", () => {
    // The reversed overclaim to guard against now: telling a visitor they must
    // be reviewed or approved before they can use OpenPlan. Services fit-review
    // language is fine; gating the SOFTWARE behind approval is not.
    const combined = PUBLIC_PAGE_FILES.map(publicPageSource).join("\n");
    expect(combined).not.toMatch(/\b(?:request|apply for|wait for)\b[^.\n]{0,60}\baccess\b[^.\n]{0,60}\b(?:before you can|to use|to sign in|to get into)\b[^.\n]{0,40}\b(?:openplan|the (?:app|software|workspace))\b/i);
    expect(combined).not.toMatch(/\bfounder\b[^.\n]{0,40}\b(?:approval|review|fit)\b[^.\n]{0,40}\b(?:required|before)\b/i);
  });

  it("keeps public modeling language inside screening-grade and supervised-review boundaries", () => {
    const combinedPublicSource = PUBLIC_PAGE_FILES.map(publicPageSource).join("\n");
    const caveatStrippedSource = sourceWithoutExplicitCaveats(combinedPublicSource);

    expect(combinedPublicSource).toMatch(/screening[- ]grade/i);
    expect(caveatStrippedSource).not.toMatch(/\b(?:calibrated|validated|certified|planning[- ]grade)\b.{0,120}\b(?:forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)\b/i);
  });

  it("keeps the free/open-source posture explicit on the landing page", () => {
    const landing = publicPageSource(LANDING_PAGE);
    expect(landing).toMatch(/open[- ]source/i);
    expect(landing).toMatch(/no payment|free and open source|free/i);
  });
});
