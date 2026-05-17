import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

const PROHIBITED_PUBLIC_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "self-serve SaaS availability",
    pattern: /\b(?:self[- ]serve|self service)\b.{0,80}\b(?:saas|subscription|account|workspace|tenant|onboarding|signup|sign-up)\b/i,
  },
  {
    label: "instant or automatic workspace provisioning",
    pattern: /\b(?:instant|automatic|automated|immediate|one[- ]click)\b.{0,80}\b(?:provision(?:ing|ed)?|workspace creation|workspace activation|tenant creation|onboarding)\b/i,
  },
  {
    label: "autonomous grant, legal, or compliance work",
    pattern: /\bautonomous\b.{0,80}\b(?:grant|legal|lapm|compliance|permitting|approval|decision|award|application)\b/i,
  },
  {
    label: "legal-grade or compliance-grade automation",
    pattern: /\b(?:legal|lapm|compliance|regulatory)[- ]grade\b.{0,80}\b(?:automation|approval|certification|review|sign[- ]off|determination)\b/i,
  },
  {
    label: "direct subscription or checkout CTA",
    pattern: /\b(?:subscribe now|start(?: your)? subscription|start(?: your)? free trial|buy now|checkout now|launch checkout|create (?:starter|professional|paid) account|activate(?: your)? subscription)\b/i,
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
    .replace(/[^.\n]*(?:no|without|not|before any)[^.\n]*\b(?:automatic|automated|instant|immediate|one[- ]click)[^.\n]*/gi, "")
    .replace(/[^.\n]*(?:disabled|deliberately scoped|human control|reviewed first)[^.\n]*\b(?:checkout|subscription|provisioning|workspace|billing)[^.\n]*/gi, "")
    .replace(/[^.\n]*(?:no|not|never|without|do not|does not|cannot|isn[’']t|aren[’']t)[^.\n]*\b(?:calibrated|validated|certified|planning[- ]grade|forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)[^.\n]*/gi, "")
    .replace(/[^.\n]*\b(?:screening[- ]grade|prototype[- ]only|internal prototype only|caveat|supervised review|qualified reviewer)[^.\n]*\b(?:calibrated|validated|certified|planning[- ]grade|forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)[^.\n]*/gi, "");
}

describe("public page claims guardrails", () => {
  it.each(PUBLIC_PAGE_FILES)("keeps %s out of public SaaS/provisioning/legal/award overclaim posture", (file) => {
    const source = sourceWithoutExplicitCaveats(publicPageSource(file));

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(source, `${file} contains prohibited public claim: ${label}`).not.toMatch(pattern);
    }
  });

  it("keeps public access language anchored to fit review instead of automatic activation", () => {
    const combinedPublicSource = PUBLIC_PAGE_FILES.map(publicPageSource).join("\n");

    expect(combinedPublicSource).toMatch(/request access/i);
    expect(combinedPublicSource).toMatch(/fit review/i);
    expect(combinedPublicSource).toMatch(/no automatic checkout or workspace creation/i);
    expect(combinedPublicSource).not.toMatch(/\b(?:request access|sign up|get started)\b.{0,120}\b(?:instant|automatic|automated|one[- ]click)\b.{0,120}\b(?:workspace|subscription|tenant|checkout)\b/i);
  });

  it("keeps public modeling language inside screening-grade and supervised-review boundaries", () => {
    const combinedPublicSource = PUBLIC_PAGE_FILES.map(publicPageSource).join("\n");
    const caveatStrippedSource = sourceWithoutExplicitCaveats(combinedPublicSource);

    expect(combinedPublicSource).toMatch(/screening[- ]grade/i);
    expect(combinedPublicSource).toMatch(/not (?:a )?(?:product tour and not a )?forecasting claim|not production-ready forecasting|not for funding-grade conclusions/i);
    expect(combinedPublicSource).toMatch(/qualified reviewer|supervised early access|supervised review/i);
    expect(caveatStrippedSource).not.toMatch(/\b(?:calibrated|validated|certified|planning[- ]grade)\b.{0,120}\b(?:forecast(?:ing|s)?|demand model(?:ing)?|travel demand|traffic volume|ridership|vmt)\b/i);
  });
});
