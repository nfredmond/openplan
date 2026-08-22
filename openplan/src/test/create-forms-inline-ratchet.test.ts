import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "./helpers/source-text";

/**
 * THE SHRINK-ONLY LIST OF FORMS THAT STILL SIT OPEN ON A PAGE.
 *
 * ═════════════════════════════════════════════════ WHY THIS GUARD EXISTS
 *
 * Nathaniel's complaint, in his words, is that OpenPlan's module pages are
 * congested: you go to `/reports` to READ a list of reports and the first thing
 * on screen is a ten-field form for making a new one, permanently expanded,
 * whether or not you came to make anything. There are 43 client components in
 * this repo that render a `<form>` and POST it, and almost all of them paint
 * themselves open above the list they sit on.
 *
 * The fix is `src/components/ui/guided-flow.tsx`: a bounded create becomes a
 * button that opens a stepped sheet, and closes again. That is a per-component
 * conversion, and this round converts eight of the 43. Without a mechanism the
 * other thirty-five are a convention — and CLAUDE.md's standing finding is that
 * every convention only written down has been violated at least once. Worse, a
 * NEW module built next month would add a thirty-sixth inline form and nothing
 * would notice.
 *
 * So the debt is a list, the list may only shrink, and adding to it costs a
 * written reason that a reviewer can argue with.
 *
 * ═══════════════════════════════════════════════════ WHAT IT CAN SEE
 *
 * It scans every `.tsx` under `src/components` and `src/app`, with comments
 * blanked first (`stripSourceComments` — a paragraph ABOUT a form is not a
 * form; that exact mistake has broken five guards in this repo), and calls a
 * file an INLINE WRITE FORM when all three of these are true of the code:
 *
 *   1. it is a client component (`"use client"`),
 *   2. it renders a `<form` element,
 *   3. it sends a POST.
 *
 * Every such file must then be accounted for in exactly one of three ways:
 *
 *   - it imports `@/components/ui/guided-flow` — converted, nothing to declare;
 *   - it is named in `NOT_A_GUIDED_FLOW` with the rule that exempts it;
 *   - it is named in `AWAITING_CONVERSION`, the debt list, which may only
 *     shrink (`AWAITING_CONVERSION_CEILING` below is a `<=` assertion whose
 *     number is allowed to go down and never up).
 *
 * The accounting is an EQUALITY in both directions, so the lists clean
 * themselves: a file that stops matching the detector — deleted, converted,
 * or no longer posting — makes its own entry stale and fails the build until
 * the entry is removed. A list that can only be appended to rots into a lie;
 * this one cannot.
 *
 * ═══════════════════════════════════════════ WHAT IT CANNOT SEE — READ THIS
 *
 * This is a TEXT scan over source files. Modelled on
 * `every-api-route-has-a-caller.test.ts`, and it inherits that guard's whole
 * class of blindness plus some of its own:
 *
 *   - **It cannot tell a good conversion from a bad one.** Importing
 *     `guided-flow` satisfies this guard. A component that imports the
 *     primitive, renders it, and ALSO leaves the old form open underneath
 *     passes here. Only a test that renders the surface can see that.
 *   - **It cannot see whether the flow is reachable.** A guided flow whose
 *     trigger button is behind a permission nobody has, or on a tab nobody
 *     opens, is invisible to this file. That is the repo's most expensive
 *     recurring defect (11+ instances) and no text scan has ever caught it.
 *   - **It cannot measure layout.** Whether the sheet is full-height on a
 *     phone, whether the footer stays on screen, whether focus moved — jsdom
 *     applies no stylesheet and has no box model, so none of that is provable
 *     in this suite at all. Those are browser measurements, permanently.
 *   - **It cannot see a form that does not say `<form`.** A component that
 *     wires an `onClick` to a POST with no form element is a write surface and
 *     this guard will not count it. Detection is deliberately narrow — a wide
 *     detector that swept in every button would have made the list unusable
 *     and the list is the point.
 *   - **It cannot see a PATCH-only editor.** Editing a record in place is
 *     explicitly NOT the target (see the rules below), so a PATCH form is out
 *     of scope by design, not by accident.
 *
 * ══════════════════════════════════════ THE RULES THAT DECIDE THE EXEMPTIONS
 *
 * First match wins. A form is NOT a candidate for a guided flow when:
 *
 *   R1. the person needs to SEE the thing they are changing while they change
 *       it — a map, a geometry, a row in a list. A modal covers it.
 *   R2. it edits a record that already exists, in place. Progressive
 *       disclosure ("Edit") is the right fix there, not a popup.
 *   R3. it is an editing WORKSPACE — long, tabular, revisited over weeks, or
 *       something a person needs to link to and resume. That wants its own
 *       route, which a modal cannot have: no URL, no back button.
 *   R4. it is a PUBLIC-facing surface. A resident meets OpenPlan through these
 *       and a modal there is a dark pattern and an accessibility risk.
 *
 * Anything else — a bounded create with a handful of answers that ends and
 * hands you back to what you were doing — belongs in a guided flow.
 */

const SCAN_ROOTS = ["src/components", "src/app"] as const;
const GUIDED_FLOW_IMPORT = "@/components/ui/guided-flow";

/**
 * Permanently inline, each with the rule that exempts it and the reason in
 * plain words. These are claims a reviewer can check by opening the file.
 *
 * This list is allowed to grow — that is the escape hatch a new module needs —
 * but growing it is a decision somebody wrote down and can be argued with,
 * which is the whole difference between this and a convention.
 */
const NOT_A_GUIDED_FLOW: Record<string, string> = {
  /*
    MOVED 2026-08-14, not deleted. The `<form>` used to live inside
    `public-engagement-portal.tsx` as `SubmissionForm`, which made it the SECOND
    implementation of the form `/engage/<token>` already rendered. All three
    public doors now render this one file, so this is where the rule applies.
  */
  "src/components/engagement/portal-submission-form.tsx":
    "R4 — this IS the public comment form, on all three of its routes. A resident's comment form must be the page, not a popup over one.",
  "src/components/engagement/public-subscribe-form.tsx":
    "R4 — public. Asking a resident for their email address inside a modal they did not open is the shape of a newsletter dark pattern.",
  "src/components/engagement/public-survey-form.tsx":
    "R4 — public, and long. A resident may be on a phone on transit; the survey has to survive a reload and be linkable.",
  "src/components/engagement/close-loop-builder.tsx":
    "R3 — an editing workspace. Writing back to everyone who commented is drafted over days, not answered in four steps.",
  "src/components/engagement/survey-builder.tsx":
    "R3 — an editing workspace. Questions are added, reordered and revised over weeks against a live campaign.",
  "src/components/engagement/engagement-item-composer.tsx":
    "R1 — list-coupled. It composes an item against the moderation queue beside it; covering the queue with the composer loses the context the operator is composing from.",
  "src/components/rtp/rtp-financial-ledger-editor.tsx":
    "R3 — an editing workspace. Revenue and O&M lines are tabular, per-period, and revisited every time an assumption changes.",
  "src/components/rtp/rtp-performance-measure-editor.tsx":
    "R3 — an editing workspace. Measures, targets and observed values accumulate across a whole plan cycle.",
  "src/components/rtp/rtp-horizon-band-editor.tsx":
    "PARTIAL — the ADD form is a guided flow; the per-period EDIT form stays inline under R2, beside the period it edits. The file keeps a `<form>` because of the editor, so it stays declared here rather than reading as unconverted.",
  "src/components/reports/report-detail-controls.tsx":
    "R2 — edits the report the page already is.",
  "src/components/knowledge-base/knowledge-base-workspace.tsx":
    "R3 — the document library is a workspace: upload, OCR, chunk review, citation. Not a bounded create.",
  "src/components/invoicing/staff-and-rates-panel.tsx":
    "R1 — list-coupled. Rates are entered against the roster shown beside them; the comparison is the point.",
  "src/components/invoicing/time-entry-composer.tsx":
    "R1 — list-coupled. Hours are logged against the week's existing entries, which have to stay visible.",
  "src/components/invoicing/client-composer.tsx":
    "R1 — list-coupled, RECLASSIFIED 2026-08-22, and it is an editor as well. On `receivables-lane.tsx` it is rendered TWICE: once to add a client under the heading \"Who this workspace bills\", and once with `client={composerRecord}` INSIDE a row of that same list, to edit it. A modal covers the list in the first case and replaces the row being edited in the second.",
  "src/components/invoicing/engagement-composer.tsx":
    "R1 — list-coupled, RECLASSIFIED 2026-08-22, and an editor too. The same shape as `client-composer.tsx` beside it: one instance adds an engagement to the client list, another is rendered inside a client's row to edit an existing one.",
  "src/components/scenarios/scenario-entry-composer.tsx":
    "R1 — list-coupled, RECLASSIFIED 2026-08-22. It sits directly above `ScenarioEntryRegistry` — already exempt here for the same reason — and adds entries to it. Its OPTIONS depend on that register's contents: `hasBaseline` removes \"baseline\" from the type list once one exists, so the composer cannot be understood apart from the list it is filling.",
  "src/components/invoicing/client-invoice-composer.tsx":
    "R1 — list-coupled, RECLASSIFIED 2026-08-22 (it was on the debt list as a bounded create; that reading was wrong). On `receivables-lane.tsx` it sits between the client's existing invoices ABOVE it and the unbilled-hours ledger BELOW it — a section the page itself titles \"The ledger behind the lines\" — and its Pull unbilled time button draws from exactly that ledger. A modal hides both the hours the lines are made of and the invoices already sent to that client, which is what stops a duplicate. `time-entry-composer.tsx` writes into the same ledger and is exempt for the same reason.",
  "src/components/projects/project-spend-entry-form.tsx":
    "R1 — list-coupled. Spend is entered against the award's running total on the same screen.",
  "src/components/projects/project-rtp-linker.tsx":
    "R1 — list-coupled. It links a project into plan periods listed beside it.",
  "src/components/projects/stage-gate-decision-recorder.tsx":
    "R1 — the gate criteria being decided are on the page. Covering them with the decision form is the regression.",
  "src/components/scenarios/scenario-spine-panel.tsx":
    "R1 — the spine it writes into is the surrounding surface.",
  "src/components/scenarios/scenario-entry-registry.tsx":
    "R1 — list-coupled; it edits entries in the register it renders.",
  "src/components/workspaces/workspace-team-panel.tsx":
    "R1 — invites are sent against the member list shown beside them, and a duplicate invite is what the list prevents.",
  "src/components/workspaces/workspace-integration-keys-panel.tsx":
    "R1 — keys are issued and revoked against the list of live keys; the list is the safety check.",
  "src/app/(app)/models/_components/network-package-upload-form.tsx":
    "R1 — an upload bound to the model's network state, which the person is reading while they upload.",
};

/**
 * THE DEBT. Bounded creates that should become guided flows and have not yet.
 * This list may only shrink.
 */
const AWAITING_CONVERSION: string[] = [
  "src/components/aerial/aerial-evidence-package-creator.tsx",
  "src/components/aerial/aerial-processing-request.tsx",
  "src/components/invoicing/invoice-record-composer.tsx",
  "src/components/projects/work-plan-template-applier.tsx",
];

/**
 * `AWAITING_CONVERSION.length` may go DOWN and never up.
 *
 * A bare equality would fail on every conversion and invite somebody to "fix"
 * it by editing the number in either direction. A `<=` fails only when the debt
 * GROWS, which is the thing being prevented, and lowering it as the list
 * shrinks is an ordinary part of landing a conversion.
 */
/*
 * 18 → 17 → 16 in one session. `model-creator.tsx` and
 * `project-record-composer.tsx` were both on the list below and both came off
 * when the first conversion round landed — each time this guard failed BY NAME
 * and the entry had to be deleted. That is the ratchet doing its job, recorded
 * here rather than described somewhere nobody reads.
 *
 * 16 → 15 → 14 on 2026-08-22: `plan-creator.tsx`, `scenario-set-creator.tsx`.
 *
 * 9 → 6 on 2026-08-22, ALL THREE reclassifications rather than conversions:
 * `client-composer`, `engagement-composer`, `scenario-entry-composer`. Four of
 * the original eighteen have now turned out to be list-coupled rather than
 * bounded creates, which says something about the DETECTOR and is worth
 * recording: it finds a client component that renders a `<form>` and POSTs,
 * and that is genuinely all it can see. Whether the form is coupled to a list
 * beside it — the R1 question — is a fact about the PAGE, and only reading the
 * page settles it. So a name arriving on this list is a candidate, never a
 * verdict; check the page before converting, and expect the ceiling to fall
 * for reclassification sometimes as well as for work.
 *
 * 14 → 13 the same day WITHOUT A CONVERSION, and that distinction matters:
 * `client-invoice-composer.tsx` was RECLASSIFIED to `NOT_A_GUIDED_FLOW` under
 * R1 rather than converted. Reading its page settled it — the composer is
 * flanked by the invoices already sent to that client and by the unbilled-hours
 * ledger it pulls its lines from. A ceiling that falls for a reclassification
 * is not the same as one that falls for work, so it is written down here; the
 * reason beside the entry is the thing to argue with if this is wrong. It failed by name twice, exactly
 * as designed — once for "listed but no longer a POSTing form", once for
 * "converted but still on the list" — and both entries had to go.
 */
const AWAITING_CONVERSION_CEILING = 4;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

type Scanned = {
  file: string;
  isInlineWriteForm: boolean;
  importsGuidedFlow: boolean;
};

function scan(): Scanned[] {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const files = SCAN_ROOTS.flatMap((root) => walk(path.join(repoRoot, root)));

  return files.map((absolute) => {
    const file = path.relative(repoRoot, absolute).split(path.sep).join("/");
    const code = stripSourceComments(readFileSync(absolute, "utf8"));
    const isClient = /["']use client["']/.test(code);
    const rendersForm = /<form[\s>]/.test(code);
    /*
      A FORM THAT WRITES, WHETHER OR NOT THE WORD "POST" IS IN THIS FILE.

      The detector used to be `/["']POST["']/` alone, which meant a form lost its
      coverage the moment its request moved into a shared module — and moving a
      request into a shared module is something this repository actively asks for
      (a capability living inside one of its callers gets reimplemented, wrongly,
      by the other). The public comment form did exactly that on 2026-08-14: it
      became one implementation behind `submitPortalInput`, and it stopped being
      a form this guard could see.

      Shared write helpers are therefore named. A NAMED LIST rather than
      something wide like `/fetch\(/`: a wide detector sweeps in every read and
      makes the accounting list unusable, and the list is the whole point.
    */
    const SHARED_WRITE_HELPERS = ["submitPortalInput"];
    const posts =
      /["']POST["']/.test(code) || SHARED_WRITE_HELPERS.some((helper) => code.includes(helper));
    return {
      file,
      isInlineWriteForm: isClient && rendersForm && posts,
      importsGuidedFlow: code.includes(GUIDED_FLOW_IMPORT),
    };
  });
}

const scanned = scan();
const inlineWriteForms = scanned.filter((entry) => entry.isInlineWriteForm);

describe("create forms: the inline-form list may only shrink", () => {
  it("finds write forms at all — a detector that matches nothing proves nothing", () => {
    // A negative control. If the detector silently stopped matching (a rename
    // of `stripSourceComments`, a repo-wide move) every assertion below would
    // pass vacuously with two empty sets.
    expect(inlineWriteForms.length).toBeGreaterThan(20);
  });

  it("accounts for every inline write form exactly once", () => {
    const unaccounted = inlineWriteForms
      .filter(
        (entry) =>
          !entry.importsGuidedFlow &&
          !(entry.file in NOT_A_GUIDED_FLOW) &&
          !AWAITING_CONVERSION.includes(entry.file)
      )
      .map((entry) => entry.file);

    expect(
      unaccounted,
      "A new client component renders a <form> and POSTs it, and nothing on the page can close it.\n" +
        "Either build it with `GuidedFlow` from @/components/ui/guided-flow, or add it to\n" +
        "NOT_A_GUIDED_FLOW in this file with the rule (R1–R4) that exempts it.\n" +
        "Adding it to AWAITING_CONVERSION is not an option: that list may only shrink."
    ).toEqual([]);
  });

  it("carries no stale exemptions", () => {
    const stillMatching = new Set(inlineWriteForms.map((entry) => entry.file));
    const stale = Object.keys(NOT_A_GUIDED_FLOW).filter((file) => !stillMatching.has(file));

    expect(
      stale,
      "These files are exempted from the guided-flow rule but no longer render a POSTing <form>.\n" +
        "Delete their entries from NOT_A_GUIDED_FLOW — a list that only ever grows stops being evidence."
    ).toEqual([]);
  });

  it("carries no stale debt", () => {
    const stillMatching = new Set(inlineWriteForms.map((entry) => entry.file));
    const stale = AWAITING_CONVERSION.filter((file) => !stillMatching.has(file));

    expect(
      stale,
      "These files are listed as unconverted but no longer render a POSTing <form>.\n" +
        "If they were converted, delete the entry and lower AWAITING_CONVERSION_CEILING."
    ).toEqual([]);
  });

  it("does not let a listed file claim to be converted as well", () => {
    // Belt and braces: a file that imports the primitive AND stays on the debt
    // list would let the ceiling stop falling while the work is actually done.
    const both = AWAITING_CONVERSION.filter((file) =>
      scanned.some((entry) => entry.file === file && entry.importsGuidedFlow)
    );

    expect(
      both,
      "Converted, but still on the debt list. Delete the entry and lower AWAITING_CONVERSION_CEILING."
    ).toEqual([]);
  });

  /*
   * The exemption list is deliberately allowed to grow — a new module needs an
   * escape hatch. What must NOT be allowed is an exemption that is a freeform
   * excuse, because then the hatch becomes the convention this file exists to
   * replace. So every exemption has to cite one of the four rules declared at
   * the top, and say something beyond the citation.
   *
   * This does not judge whether the reason is CORRECT — no test can. It makes an
   * exemption an argument a reviewer can check against a named rule, rather than
   * a sentence nobody has to defend.
   */
  it("lets no exemption be a freeform excuse", () => {
    const DECLARED_RULES = /^R[1-4] — |^PARTIAL — /;
    const bad = Object.entries(NOT_A_GUIDED_FLOW).filter(
      ([, reason]) => !DECLARED_RULES.test(reason) || reason.trim().length < 40
    );

    expect(
      bad.map(([file]) => file),
      "Every exemption must cite one of the rules R1-R4 declared at the top of this file\n" +
        "(or PARTIAL), and then say WHY in plain words. An exemption nobody has to argue for\n" +
        "is the convention this ratchet replaced."
    ).toEqual([]);
  });

  it("keeps the debt list shrinking, with no slack to hide new debt in", () => {
    // AN EQUALITY, NOT `<=` — CHANGED 2026-08-22 BY A MUTATION THAT SURVIVED.
    //
    // This was `toBeLessThanOrEqual`, on the reasoning that a bare equality
    // fails on every conversion and invites someone to "fix" it by editing the
    // number in either direction. The cost of that choice was measured: raising
    // the ceiling from 6 to 9 PASSED. A ceiling above the real count is slack,
    // and slack is room for three new inline forms to be added later without
    // this guard saying a word — which is the whole thing it exists to prevent.
    //
    // The equality carries the same risk the original comment named, and the
    // answer is the one `planner-copy-says-the-plain-thing` already uses for
    // its BASELINE: fail in BOTH directions and say which happened, so editing
    // the number is a decision rather than a reflex. That guard has corrected
    // this session four times, in both directions.
    expect(
      AWAITING_CONVERSION.length,
      "If this ROSE, a new inline create form was appended — it belongs in a guided flow, or in\n" +
        "NOT_A_GUIDED_FLOW with a reason. If it FELL, good: lower AWAITING_CONVERSION_CEILING in the\n" +
        "same commit, so the improvement is banked and cannot be spent later on new debt."
    ).toBe(AWAITING_CONVERSION_CEILING);
  });

  it("lists no file twice", () => {
    const seen = new Set<string>();
    const duplicated: string[] = [];
    for (const file of [...Object.keys(NOT_A_GUIDED_FLOW), ...AWAITING_CONVERSION]) {
      if (seen.has(file)) duplicated.push(file);
      seen.add(file);
    }
    expect(duplicated).toEqual([]);
  });
});
