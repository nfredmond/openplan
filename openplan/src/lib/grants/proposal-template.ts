/**
 * The proposal response template: how a proposal pursuit's application
 * workspace seeds when an RFP/RFQ response is initialized.
 *
 * Same section-template type as the grant program catalog, and the same
 * seeding rules: templates SEED only (solicitations restructure constantly —
 * the current solicitation always controls), custom sections are first-class,
 * and the never-AI rule travels on the row.
 *
 * Two boundaries this template pins:
 *  - `team_qualifications` grounds on Knowledge Base documents ONLY. Staff
 *    credentials, licenses, and résumés come from documents the workspace
 *    uploaded — NEVER from model memory, which will cheerfully invent a
 *    plausible PE license number.
 *  - `fee_placeholder` is never AI-drafted (`aiDraftingEnabled: false`). Fee
 *    and cost content is operator/finance work product; the drafting route's
 *    422 refusal enforces this server-side with no override.
 */

import type { GrantApplicationSectionTemplate } from "@/lib/grants/program-catalog";
import type { ApplicationSectionSeed } from "@/lib/grants/application";

export const PROPOSAL_SECTION_TEMPLATE: readonly GrantApplicationSectionTemplate[] = [
  {
    key: "approach",
    title: "Understanding and approach",
    guidance:
      "Describe the understanding of the work and the proposed approach, grounded in the linked project record and any workspace analysis. Follow the solicitation's own outline for this section — the current solicitation always controls what an approach section must contain.",
    suggestedEvidence: ["project", "kb", "modeling"],
  },
  {
    key: "team_qualifications",
    title: "Team and qualifications",
    guidance:
      "Introduce the proposed team and its qualifications using ONLY documents uploaded to this workspace's Knowledge Base (résumés, statements of qualifications, license records). Credentials are never drafted from model memory — a claim about a person that is not in an uploaded document does not belong in this section. Verify named-staff and licensure requirements against the current solicitation.",
    suggestedEvidence: ["kb"],
  },
  {
    key: "past_performance",
    title: "Past performance and references",
    guidance:
      "Summarize comparable completed work: the workspace's completed-project history and any uploaded reference or project-sheet documents. State only engagements that appear in workspace records; verify reference-format requirements against the current solicitation.",
    suggestedEvidence: ["project", "kb"],
  },
  {
    key: "schedule",
    title: "Schedule and management",
    guidance:
      "Describe the proposed schedule and management approach from the linked project's stage and delivery data. When no dated schedule exists in workspace records, describe sequencing qualitatively — never invent dates or durations. Verify milestone and deliverable expectations against the current solicitation.",
    suggestedEvidence: ["project"],
  },
  {
    key: "fee_placeholder",
    title: "Fee and cost proposal",
    guidance:
      "Fee schedules, rates, and cost content come from your own estimates and rate records — this section is never AI-drafted. Many solicitations require the fee in a separate sealed envelope or portal upload; verify the current solicitation's fee-submission format.",
    suggestedEvidence: ["funding"],
    aiDraftingEnabled: false,
  },
];

/**
 * Build section insert payloads from the proposal template, in order. Seeded
 * rows carry source 'catalog' — the shared meaning is "template-seeded":
 * not deletable (a solicitation's real structure must stay visible to
 * review), and the never-AI pin can never be flipped back to draftable.
 */
export function buildProposalSectionSeeds(): ApplicationSectionSeed[] {
  return PROPOSAL_SECTION_TEMPLATE.map((template, index) => ({
    section_key: template.key,
    title: template.title,
    guidance: template.guidance,
    sort_order: index,
    source: "catalog",
    suggested_evidence: [...template.suggestedEvidence],
    ai_drafting_enabled: template.aiDraftingEnabled !== false,
  }));
}
