/**
 * United States — generic federal-aid grant-reimbursement profile.
 *
 * The nationwide floor: the reimbursement posture vocabulary a US agency logs
 * a grant draw under when no state- or funder-specific profile has been
 * authored for its jurisdiction. It describes common federal-aid practice
 * under the OMB Uniform Guidance (2 CFR part 200) — cost reimbursement for
 * expenditures incurred after the relevant phase is authorized, within the
 * period of performance. Advance payments exist under 2 CFR 200.305, but they
 * are agreement-dependent and rare for local transportation awards, so this
 * profile notes them without offering one as a posture.
 *
 * What this profile deliberately does NOT claim:
 *
 *   - It names no funder, no state DOT, and no form pack. `formPackStatus` is
 *     omitted on purpose: a jurisdiction without an exact form pack must not
 *     declare one, and omission IS the statement.
 *   - It does not outrank the executed funding agreement. The `framingNote`
 *     says so on every surface that renders this profile, because generic
 *     practice is a starting posture, never a substitute for the agreement's
 *     own invoicing exhibits.
 *
 * It carries the interim default for workspaces whose jurisdiction has no
 * profile of its own; a subdivision-scoped profile wins over it by the
 * registry's jurisdiction match, so a workspace whose own state has a profile
 * keeps that state's vocabulary. (Named neutrally on purpose: the sibling
 * descriptor's header claims to be the only invoicing file that names its
 * state's forms, and naming one here would quietly falsify that.)
 *
 * Adding another jurisdiction's reimbursement process means adding a sibling
 * descriptor file and one registration entry — never editing a call site.
 */

import type { ReimbursementProfileDescriptor } from "@/lib/invoicing/reimbursement-profiles";

export const US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE: ReimbursementProfileDescriptor = {
  profileId: "us_federal_generic_reimbursement_v1",
  profileName: "US federal-aid reimbursement (generic)",
  version: "1.0.0",
  jurisdiction: { country: "US", label: "United States" },
  postureOptions: [
    {
      postureId: "progress_invoicing",
      label: "Progress invoicing",
      description:
        "Periodic reimbursement invoices — monthly or quarterly per the funding agreement — itemized by phase, claiming costs incurred after phase authorization and within the period of performance. Advance payments exist under 2 CFR 200.305 but are agreement-dependent and rare for local transportation awards; this profile notes them without offering one as a posture.",
    },
    {
      postureId: "final_only",
      label: "Final invoice only",
      description:
        "One reimbursement invoice at project completion. Honest for small awards, but the agency carries every cost until closeout — name that cash-flow risk before choosing this posture.",
    },
    {
      postureId: "retention_in_effect",
      label: "Retention in effect",
      description:
        "The funder withholds a portion of each reimbursement pending closeout, released when closeout requirements are met.",
    },
    {
      postureId: "deferred_agreement_terms",
      label: "Agreement terms deferred",
      description:
        "The executed agreement's own invoicing exhibits govern this draw and have not been configured here yet; the record is tracked now and the agreement terms are attached later.",
    },
  ],
  defaultPostureId: "progress_invoicing",
  // The honesty line every surface rendering this profile shows: generic
  // practice never outranks the agreement an agency actually signed.
  framingNote:
    "Generic US federal-aid reimbursement practice. Your executed funding agreement controls — where it differs from this profile, the agreement wins.",
  documentationChecklist: [
    {
      key: "itemized_cost_ledger",
      label: "Itemized cost ledger",
      guidance:
        "Costs broken out by phase and cost category, tied to the amounts claimed on this invoice — the ledger is what a funder's reviewer reconciles first.",
    },
    {
      key: "source_documentation",
      label: "Source documentation",
      guidance:
        "The records behind each ledger line: vendor and consultant invoices, payrolls, and executed contracts. Verify what your funder requires attached versus retained on file.",
    },
    {
      key: "indirect_cost_basis",
      label: "Indirect cost basis",
      guidance:
        "The basis for any indirect costs claimed: a current negotiated indirect cost rate agreement, or the de minimis rate elected under 2 CFR 200.414(f). Verify which basis your agreement allows before claiming.",
    },
    {
      key: "match_computation",
      label: "Match / local-share computation",
      guidance:
        "How the non-federal share on this draw was computed, consistent with the match commitment in the executed agreement.",
    },
    {
      key: "cost_certification",
      label: "Cost certification",
      guidance:
        "The signing official's certification that the costs claimed are true, eligible under the award, and not claimed for reimbursement elsewhere.",
    },
  ],
  // No submittedToHint: the composer's neutral placeholder ("Funder or program
  // office") is the honest hint when no specific funder office is known.
  // No formPackStatus: this profile has no form pack to describe.
  //
  // Carries the interim default for workspaces whose jurisdiction has no
  // profile of its own — the nationwide floor, disclosed as assumed whenever
  // it applies that way. Not a statement that any workspace chose it.
  isInterimDefault: true,
};
