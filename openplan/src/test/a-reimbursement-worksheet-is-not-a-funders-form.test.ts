import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ReimbursementWorksheetDownload } from "@/components/invoicing/reimbursement-worksheet-download";
import { buildAwardDrawdownLedger, type AwardDrawdownLedger } from "@/lib/invoicing/drawdown-ledger";
import {
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
  WORKSHEET_PREPARED_NOTE,
} from "@/lib/invoicing/reimbursement-worksheet";
import {
  resolveReimbursementProfile,
  type ReimbursementProfileBinding,
} from "@/lib/invoicing/reimbursement-profile-binding";
import {
  createReimbursementProfileRegistry,
  reimbursementProfileRegistry,
  type ReimbursementProfileDescriptor,
} from "@/lib/invoicing/reimbursement-profiles";

/**
 * A REIMBURSEMENT WORKSHEET IS NOT A FUNDER'S FORM.
 *
 * The failure this guard exists to prevent is specific and plausible: OpenPlan
 * produces a tidy, official-looking packet of an agency's reimbursement
 * position, a planner takes it to be the exhibit their funding agreement
 * requires, and submits it. Nobody is lied to at any point — the document is
 * simply good enough to be mistaken for the real thing, and nothing on it says
 * otherwise. Everything below is here so that a future edit which makes the
 * packet MORE form-like fails the build.
 *
 * TWO ASSERTIONS, and the difference between them matters:
 *
 *   1. THE NOTE IS PRESENT — on page one and in the footer that repeats on
 *      every printed page, because page one gets separated from a packet.
 *   2. THE CHROME MAKES NO FORM CLAIM — no form number, no numbered exhibit, no
 *      revision date, and the words "official" and "certified" nowhere in
 *      OpenPlan's own voice.
 *
 * WHERE THIS DEVIATES FROM THE DESIGN MEMO, and why (report this, do not
 * quietly absorb it): the memo asked for a blanket ban on `/\bofficial\b/i`
 * across the whole rendered document. That is not implementable as written,
 * because a REAL shipped profile — the nationwide US federal-aid descriptor —
 * ends its documentation checklist with "The signing official's certification
 * that the costs claimed are true". That is a job title inside funder-authored
 * guidance, not OpenPlan calling its own document official, and banning it
 * would mean either deleting honest checklist guidance or never rendering the
 * checklist at all. So the ban is enforced against OPENPLAN'S OWN CHROME: the
 * scan runs over a document rendered with profiles and workspace data that
 * contain none of the banned words, so any hit is the builder's. A separate
 * test below pins the real-profile exception by name, so it cannot widen
 * silently into "the guard does not really check anything".
 */

/** What OpenPlan may never say about a document it generated itself. */
const FORM_CLAIM_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "a form number", pattern: /\bform\s*(no\.?|#)\s*\d/i },
  { label: "a numbered exhibit", pattern: /\bexhibit\s+\d/i },
  { label: "a revision date", pattern: /rev(?:ision)?\.?\s*\d{1,2}[\/-]\d{2,4}/i },
  { label: "the word official", pattern: /\bofficial\b/i },
  { label: "the word certified", pattern: /\bcertified\b/i },
  // Added with the in-app control below. A packet cannot be "compliant" — only
  // a submission against a specific agreement can — and "ready to submit" is
  // the single sentence most likely to stop a planner checking their exhibit.
  { label: "a compliance claim", pattern: /\bcompliant\b/i },
  { label: "a ready-to-submit claim", pattern: /\bready[\s-]to[\s-]submit\b/i },
];

/**
 * A neutral profile: a real-sounding process whose every string is free of the
 * banned vocabulary, so the scan below measures the BUILDER and nothing else.
 */
const NEUTRAL_PROFILE: ReimbursementProfileDescriptor = {
  profileId: "us_wa_tib_reimbursement_v1",
  profileName: "Washington TIB reimbursement",
  version: "1.0.0",
  jurisdiction: { country: "US", subdivision: "WA", label: "Washington, United States" },
  postureOptions: [{ postureId: "progress_claim", label: "Progress claim" }],
  defaultPostureId: "progress_claim",
  submittedToHint: "Transportation Improvement Board, Grant Services",
  formPackStatus: "deferred_exact_forms",
  framingNote: "Your executed funding agreement controls — where it differs from this profile, the agreement wins.",
  documentationChecklist: [
    {
      key: "progress_report",
      label: "Progress report",
      guidance: "The reporting period's progress narrative in the format your agreement names.",
    },
    {
      key: "cost_ledger",
      label: "Itemized cost ledger",
      guidance: "Costs broken out by phase and category, tied to the amounts claimed.",
    },
  ],
  isInterimDefault: true,
};

const AWARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const neutralRegistry = createReimbursementProfileRegistry([NEUTRAL_PROFILE]);

function neutralBinding(): ReimbursementProfileBinding {
  const resolution = resolveReimbursementProfile({
    workspaceJurisdiction: { country: "US", subdivision: "WA" },
    registry: neutralRegistry,
  });
  if (resolution.kind !== "resolved") throw new Error("neutral fixture profile did not resolve");
  return resolution.binding;
}

function builtInBinding(subdivision: string | null): ReimbursementProfileBinding {
  const resolution = resolveReimbursementProfile({
    workspaceJurisdiction: { country: "US", subdivision },
    registry: reimbursementProfileRegistry,
  });
  if (resolution.kind !== "resolved") throw new Error("built-in profile did not resolve");
  return resolution.binding;
}

function ledger(): AwardDrawdownLedger {
  const result = buildAwardDrawdownLedger({
    award: { awarded_amount: "250000.00", match_amount: "32362.50", match_posture: "secured" },
    invoiceRead: {
      ok: true,
      invoices: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          invoice_number: "RB-001",
          status: "paid",
          amount: "80000.00",
          retention_percent: 5,
          invoice_date: "2026-01-15",
          paid_date: "2026-02-10",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          invoice_number: "RB-002",
          status: "submitted",
          amount: "12000.00",
          retention_percent: 0,
          invoice_date: "2026-02-20",
        },
      ],
    },
  });
  if (!result.ok) throw new Error("fixture ledger failed to build");
  return result.ledger;
}

/** The packet as OpenPlan's own voice alone: neutral profile, neutral data. */
function renderNeutral(overrides: Partial<Parameters<typeof buildReimbursementWorksheetHtml>[0]> = {}): string {
  return buildReimbursementWorksheetHtml({
    workspace: { name: "Sierra Regional Transportation Agency" },
    award: { title: "Ridge Corridor Safety Improvements", projectName: "Ridge Corridor" },
    period: { start: "2026-01-01", end: "2026-02-28" },
    ledger: ledger(),
    profile: neutralBinding(),
    costs: summarizeWorksheetCostEntries({
      ok: true,
      entries: [{ entry_date: "2026-01-08", description: "Traffic counts", vendor_label: "Sierra Counts LLC", amount: "4210.75" }],
    }),
    ...overrides,
  });
}

describe("a reimbursement worksheet is not a funder's form", () => {
  it("says so on page one and in the footer that repeats on every page", () => {
    const html = renderNeutral();

    expect(html).toContain(`<p class="prepared-note">${WORKSHEET_PREPARED_NOTE}</p>`);
    expect(html).toContain(`<div class="page-footer">${WORKSHEET_PREPARED_NOTE}</div>`);

    // The three things the note has to actually say.
    expect(WORKSHEET_PREPARED_NOTE).toContain("It is not a funder's form");
    expect(WORKSHEET_PREPARED_NOTE).toContain("carries no form or revision number");
    expect(WORKSHEET_PREPARED_NOTE).toMatch(/check it against the exhibit your funding agreement/i);
  });

  it("makes no form claim anywhere in OpenPlan's own voice", () => {
    const html = renderNeutral();
    const claimed = FORM_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(html)).map(({ label }) => label);

    expect(
      claimed,
      [
        "The reimbursement worksheet made a claim that belongs to a funder's own paperwork.",
        "This document is generated from a workspace's own records; a planner who mistakes it",
        "for the exhibit their agreement requires will submit the wrong thing.",
        "Remove the claim. Do not widen the neutral fixture to make the scan pass.",
      ].join("\n")
    ).toEqual([]);
  });

  it("calls itself a worksheet, not an invoice or a claim form", () => {
    const html = renderNeutral();
    expect(html).toContain("<p class=\"doc-title\">Reimbursement worksheet</p>");
    expect(html).not.toMatch(/doc-title">\s*(invoice|claim|reimbursement request)/i);
  });

  /**
   * GUARD THE GUARD (negative control). Every pattern above must be able to
   * FAIL — a scan whose regexes never match anything is a scan that proves
   * nothing. Each is fired here at a document deliberately made bad, and the
   * bad text is inserted the way a real regression would insert it: as chrome
   * around the same builder output.
   */
  it("the scan can actually fail — each pattern fires on a deliberately bad document", () => {
    const base = renderNeutral();
    const offenders = [
      "Form No. 3",
      "See Exhibit 10 attached",
      "Rev. 06/2024",
      "This is the official reimbursement packet",
      "certified true and correct",
    ];

    for (const offender of offenders) {
      const bad = base.replace("</body>", `<p>${offender}</p></body>`);
      const claimed = FORM_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(bad));
      expect(claimed.length, `"${offender}" slipped past every pattern`).toBeGreaterThan(0);
    }

    // …and the clean document is genuinely clean, so the loop above is not
    // passing because everything matches everything.
    expect(FORM_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(base))).toEqual([]);
  });

  it("the note's absence is detectable — deleting it fails this file's first test", () => {
    // The mutation performed by hand during development (remove the
    // prepared-note paragraph from the builder) is encoded here as its
    // observable consequence, so the assertion is not merely "a string I
    // control appears in output I control".
    const html = renderNeutral();
    const withoutNote = html.split(WORKSHEET_PREPARED_NOTE).join("");
    expect(withoutNote).not.toContain(WORKSHEET_PREPARED_NOTE);
    expect(html.split(WORKSHEET_PREPARED_NOTE).length - 1).toBe(2);
  });
});

describe("the real shipped profiles, and the one exception this guard tolerates", () => {
  /**
   * The nationwide US federal-aid profile ships a checklist item reading "The
   * signing official's certification that the costs claimed are true". That is
   * the word "official" as a JOB TITLE inside funder-authored guidance — a real
   * thing an agency needs a real person to sign — and it is not OpenPlan
   * calling its own output official.
   *
   * This test pins the exception rather than widening the ban's scope: every
   * `official` in a real-profile render must be inside a string the PROFILE
   * declared. A new one in the builder's chrome is not covered by this and
   * fails the neutral scan above.
   */
  it("tolerates 'official' only where a profile's own checklist put it", () => {
    const binding = builtInBinding("TX"); // the nationwide generic tier
    expect(binding.documentationChecklist).not.toBeNull();

    const html = renderNeutral({ profile: binding });
    expect(/\bofficial\b/i.test(html)).toBe(true);

    // Subtract every string the profile supplied. What remains is the builder.
    const profileStrings = [
      binding.profileName,
      binding.framingNote ?? "",
      binding.submittedToHint ?? "",
      ...(binding.documentationChecklist ?? []).flatMap((item) => [item.label, item.guidance]),
      ...binding.postureOptions.flatMap((option) => [option.label, option.description ?? ""]),
    ].filter((value) => value.length > 0);

    let chrome = html;
    for (const value of profileStrings) {
      // The builder escapes profile text on the way in, so subtract the escaped
      // form as well as the raw one.
      chrome = chrome.split(value).join(" ");
      chrome = chrome.split(value.replaceAll("'", "&#39;")).join(" ");
    }

    expect(profileStrings.some((value) => /\bofficial\b/i.test(value))).toBe(true);
    expect(
      /\bofficial\b/i.test(chrome),
      "OpenPlan's own chrome now contains the word 'official'. The profile-text exception does not cover it."
    ).toBe(false);
  });

  it("renders both shipped US tiers without any other form claim in the chrome", () => {
    for (const subdivision of ["CA", "TX", null]) {
      const binding = builtInBinding(subdivision);
      const html = renderNeutral({ profile: binding });

      // Everything except the documented `official` exception, which is
      // profile-authored and pinned by the test above.
      const claimed = FORM_CLAIM_PATTERNS.filter(
        ({ label, pattern }) => label !== "the word official" && pattern.test(html)
      ).map(({ label }) => label);

      expect(claimed, `subdivision ${subdivision ?? "unknown"} produced a form claim`).toEqual([]);
      expect(html).toContain(WORKSHEET_PREPARED_NOTE);
    }
  });
});

/**
 * THE SAME PROHIBITIONS, ON THE CONTROL THAT OFFERS THE DOCUMENT.
 *
 * Everything above scans the PDF. Nothing scanned the sentence a planner reads
 * BEFORE deciding to download it — and that sentence is where the mistake is
 * actually made. An adversarial review replaced the control's copy with
 *
 *     "This is the official Caltrans LAPM Exhibit 5-A (Rev. 06/2024),
 *      certified compliant and ready to submit as-is."
 *
 * and four guards stayed green. The document would still have carried its
 * honest note, and the planner would never have read it: they were told on
 * screen that it was the exhibit.
 *
 * This renders the REAL component and scans what a person sees. Claim-guard
 * doctrine is to guard the live surface, so the assertion is over
 * `textContent`, not over the source file — a source scan would be satisfied by
 * a string the component never renders, and defeated by one built at runtime.
 */
describe("the in-app control that offers the worksheet", () => {
  /** The rendered text of the download control, as a planner reads it. */
  function renderedControlText(): string {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(ReimbursementWorksheetDownload, { awardId: AWARD_ID, workspaceId: WORKSPACE_ID }));
    });
    const text = container.textContent ?? "";
    act(() => root.unmount());
    container.remove();
    return text;
  }

  it("makes no claim the document itself is forbidden from making", () => {
    const text = renderedControlText();
    expect(text.length).toBeGreaterThan(120); // the render actually produced copy

    const claimed = FORM_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);

    expect(
      claimed,
      [
        "The control offering the reimbursement worksheet made a claim that belongs to a",
        "funder's own paperwork. The planner reads THIS before they read the document, so a",
        "form claim here overrides every honest word inside the PDF.",
        "Remove the claim from the control's copy.",
      ].join("\n")
    ).toEqual([]);
  });

  it("tells the planner, on screen, that this is not their funder's form", () => {
    const text = renderedControlText();

    // Not merely the absence of a lie: the control has to say the thing.
    expect(text).toMatch(/not your funder's form/i);
    expect(text).toMatch(/supporting work for your own reimbursement request/i);
  });

  /**
   * GUARD THE GUARD. The reviewer's exact overclaim, fired at the same scan, so
   * this file cannot become a set of patterns that match nothing on this
   * surface.
   */
  it("the scan fires on the overclaim that slipped past four guards", () => {
    const overclaim =
      "This is the official Caltrans LAPM Exhibit 5-A (Rev. 06/2024), certified compliant and ready to submit as-is.";

    const claimed = FORM_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(overclaim)).map(({ label }) => label);

    // Every clause of it is caught, not just one.
    expect(claimed).toEqual(
      expect.arrayContaining([
        "a numbered exhibit",
        "a revision date",
        "the word official",
        "the word certified",
        "a compliance claim",
        "a ready-to-submit claim",
      ])
    );

    // …and the real control is genuinely clean, so the check above is not
    // passing because the patterns match everything.
    expect(FORM_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(renderedControlText()))).toEqual([]);
  });

  it("describes the period scoping the way the code actually scopes it", () => {
    const text = renderedControlText();

    // `selectWorksheetInvoiceLines` scopes the INVOICE TABLE by the period too,
    // so "only the itemised costs follow the period" was false: a planner who
    // set a period got a shorter invoice list than they were promised and no
    // sentence told them why.
    expect(text).not.toMatch(/only the itemi[sz]ed costs follow the period/i);
    expect(text).toMatch(/invoice/i);
    expect(text).toMatch(/follow the period/i);
  });
});
