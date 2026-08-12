/**
 * California — Caltrans LAPM grant-reimbursement profile.
 *
 * THE ONLY invoicing-domain file allowed to name Caltrans or the LAPM.
 * `src/test/invoicing-reimbursement-profiles.test.ts` enforces that: a
 * Caltrans/LAPM literal anywhere else under the invoicing surfaces fails the
 * build. Everything jurisdiction-specific about California's reimbursement
 * process — the posture vocabulary a draw is logged under, where a packet is
 * typically submitted, the status of the exact form pack — lives on this
 * descriptor so the registry, the API, and the UI stay jurisdiction-neutral.
 *
 * The posture ids are the values `billing_invoice_records.caltrans_posture`
 * has always stored (its CHECK in 20260321000033), and the labels are the ones
 * the composer has always shown, so a pre-profile row backfilled onto this
 * profile reads exactly as it did the day it was written.
 *
 * Adding another jurisdiction's reimbursement process means adding a sibling
 * descriptor file and one registration entry — never editing a call site.
 */

import type { ReimbursementProfileDescriptor } from "@/lib/invoicing/reimbursement-profiles";

export const US_CA_LAPM_REIMBURSEMENT_PROFILE: ReimbursementProfileDescriptor = {
  profileId: "us_ca_lapm_reimbursement_v1",
  profileName: "Caltrans LAPM reimbursement",
  version: "1.0.0",
  jurisdiction: { country: "US", subdivision: "CA", label: "California, United States" },
  postureOptions: [
    {
      postureId: "deferred_exact_forms",
      label: "Exact forms deferred",
      description:
        "The reimbursement record is tracked now; the exact LAPM exhibit and form ids are attached later.",
    },
    {
      postureId: "local_agency_consulting",
      label: "Local-agency consulting",
      description: "Consultant billing under a local agency's LAPM-administered contract.",
    },
    {
      postureId: "federal_aid_candidate",
      label: "Federal-aid candidate",
      description: "A draw expected to be claimed against federal-aid funds through the LAPM process.",
    },
  ],
  defaultPostureId: "deferred_exact_forms",
  submittedToHint: "Caltrans D3 Local Assistance",
  // OpenPlan does not yet generate the exact LAPM exhibit/form packet; the
  // profile says so about itself instead of every binding claiming it.
  formPackStatus: "deferred_exact_forms",
  // California workspaces reach this profile by subdivision match on their own
  // home geography; the nationwide generic profile (us-federal-generic) now
  // carries the interim default for workspaces whose jurisdiction has no
  // profile of its own. This profile carried that default only while it was
  // the sole one authored.
  // Caltrans reimburses in US dollars.
  currencyCode: "USD",
  isInterimDefault: false,
};
