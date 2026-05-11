import { PHASE1_SHARED_SPINE_PROOF_ARTIFACT } from "@/lib/operations/pilot-readiness-proof-paths";
import {
  finalPilotReadinessChecklistSync,
  getAdminPilotReadinessProofArtifactCategoryLabel,
  getAdminPilotReadinessProofArtifactIndex,
  getReleaseProofItemCaveats,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";

export type PilotReadinessPacketStatus = {
  lane: string;
  status: string;
  lastRun: string;
  details: string;
};

type MarkdownHeadingLevel = 1 | 2 | 3 | 4;

type ProofSnapshotRow = {
  area: string;
  status: string;
  evidence: string;
  sources: readonly string[];
};

type OnboardingValidationRow = {
  validation: string;
  whyItMatters: string;
};

type BuyerSafeLanguage = {
  use: readonly string[];
  avoid: readonly string[];
};

function heading(level: MarkdownHeadingLevel, text: string) {
  return `${"#".repeat(level)} ${text}`;
}

function markdownTable(rows: readonly (readonly string[])[]) {
  return rows.map((row) => `| ${row.join(" | ")} |`);
}

function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values));
}

export const adminPilotReadinessStaticPacket = {
  title: "OpenPlan Admin Pilot Readiness Proof Packet",
  originalDate: "2026-05-01",
  refreshedDate: "2026-05-10",
  status: "Buyer-safe proof export for supervised pilot and managed-service review",
  audience: "rural RTPA, county, tribe, transportation commission, or consultant buyer diligence",
  buyerSafeSummary: [
    "OpenPlan is ready to discuss as a supervised planning workbench with an Apache-2.0 open-source core and optional Nat Ford managed hosting, onboarding, implementation, support, and planning services.",
    "This packet does not claim that OpenPlan is a fully self-serve municipal SaaS, a validated behavioral forecasting platform, a complete legal/compliance automation system, a grant award prediction product, or an autonomous AI planning product.",
    "The static sales packet and the Admin Pilot Readiness export now reuse the same final-checklist sync, release-proof artifacts, and caveat list so buyer-facing diligence does not drift from the operator surface.",
  ],
  provenPostureItems: [
    "release-candidate checks across tests, lint, build, production health, audit, and public demo preflight;",
    "authenticated workspace and cross-workspace isolation behavior in local synthetic smoke;",
    "RTP/report packet creation, artifact generation, and release-review navigation;",
    "grants, funding awards, reimbursement, closeout, and RTP posture write-back;",
    "engagement public intake, moderation, public feedback publication, and report handoff;",
    "analysis/model-run output linked into scenarios and generated report artifacts;",
    "one seeded project record reused across RTP, grants, engagement, modeling evidence, reports, map, Data Hub, and aerial evidence;",
    "supervised request-access, reviewer triage, pilot workspace provisioning, owner invitation, and invited-owner acceptance;",
    "production Admin Operations access for the configured reviewer, with the service-lane intake unlocked and no prospect row capture;",
    "current billing posture with an explicit no-fresh-paid-canary waiver; and",
    "operator backup/restore procedure, completed staging restore drill, and managed-hosting service schedule language.",
  ],
  proofSnapshotRows: [
    {
      area: "Release candidate baseline",
      status: "PASS",
      evidence:
        "`pnpm test`, `pnpm lint`, `pnpm build`, production health, production audit, and public demo preflight all passed for the May 1 RC gate.",
      sources: ["docs/ops/2026-05-01-openplan-rc-proof-log.md"],
    },
    {
      area: "Public demo preflight",
      status: "PASS",
      evidence:
        "No-auth checks cover health, request-access page availability, protected billing-readiness access, Mapbox/CSP posture, and no token printing.",
      sources: [
        "openplan/docs/ops/2026-04-27-public-demo-preflight-proof.md",
        "docs/ops/2026-05-01-openplan-phase0-proof-repair.md",
      ],
    },
    {
      area: "Admin Pilot Readiness surface",
      status: "PASS",
      evidence:
        "The readiness parser reads line-item `PASS:` evidence, `/admin/pilot-readiness` was recaptured on desktop/mobile, and the export now shares final-checklist/release-proof sections with this static packet.",
      sources: [
        "docs/ops/2026-05-01-openplan-phase0-proof-repair.md",
        "docs/ops/2026-05-01-openplan-ui-ux-watch-recapture.md",
        "openplan/src/lib/operations/pilot-readiness-packet.ts",
      ],
    },
    {
      area: "Workspace isolation",
      status: "PASS",
      evidence:
        "Two synthetic users could access their own workspace project URLs and were blocked from the other workspace, with session continuity after denial.",
      sources: ["docs/ops/2026-05-01-openplan-local-workspace-url-isolation-smoke.md"],
    },
    {
      area: "RTP/report workflow",
      status: "PASS",
      evidence:
        "Local rendered smoke confirms RTP cycle creation, board-packet creation, artifact generation, registry packet navigation, and release-review anchor landing.",
      sources: ["docs/ops/2026-05-01-openplan-local-rtp-release-review-smoke.md"],
    },
    {
      area: "Grants/funding workflow",
      status: "PASS",
      evidence:
        "Local rendered/API smoke confirms funding need, awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout, and funded/reimbursed posture.",
      sources: ["docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md"],
    },
    {
      area: "Engagement handoff",
      status: "PASS",
      evidence:
        "Local rendered/API smoke confirms public feedback intake, staff moderation, public publication, handoff report provenance, HTML artifact generation, and source-context traceability.",
      sources: ["docs/ops/2026-05-01-openplan-local-engagement-report-handoff-smoke.md"],
    },
    {
      area: "Analysis/report linkage",
      status: "PASS",
      evidence:
        "Local rendered/API smoke confirms corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, report linkage, HTML artifact, and source-context traceability.",
      sources: ["docs/ops/2026-05-01-openplan-local-analysis-report-linkage-smoke.md"],
    },
    {
      area: "Phase 1 shared spine",
      status: "PASS",
      evidence:
        "Local API/rendered smoke confirms one seeded NCTC project ID is reused across RTP, grants, engagement, scenario/analysis runs, county-run modeling evidence, reports, map, Data Hub, and aerial evidence packages without duplicate project creation.",
      sources: [PHASE1_SHARED_SPINE_PROOF_ARTIFACT],
    },
    {
      area: "Admin/support onboarding flow",
      status: "PASS",
      evidence:
        "Local rendered/API smoke confirms public intake, allowlisted reviewer triage, provision-only-after-contacted gating, pilot workspace creation, owner invitation, review-event audit trail, and invited-owner acceptance.",
      sources: ["docs/ops/2026-05-01-openplan-local-admin-support-flow-smoke.md"],
    },
    {
      area: "Production Admin Operations access",
      status: "PASS",
      evidence:
        "Production authenticated browser smoke confirms the configured reviewer can load `/admin/operations`, see the service-lane intake surface unlocked, and avoid triage/provision actions or prospect row capture during proof.",
      sources: ["docs/ops/2026-05-01-openplan-production-admin-operations-authenticated-smoke.md"],
    },
    {
      area: "Billing posture",
      status: "PASS with explicit waiver",
      evidence:
        "Billing is positioned as historical live payment evidence plus current non-money-moving proof. No fresh same-cycle paid checkout canary is claimed.",
      sources: ["docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md"],
    },
    {
      area: "Managed hosting posture",
      status: "Buyer-reviewable template",
      evidence:
        "The service schedule defines scoped managed-hosting responsibilities, support targets, backup/restore fields to fill, and out-of-scope items before signature.",
      sources: ["docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md"],
    },
    {
      area: "Backup/restore posture",
      status: "PASS",
      evidence:
        "The operator procedure names durable state, backup cadence, restore decision gates, staging-first posture, validation, and customer communication boundaries. A dedicated staging Supabase project was created, migrated, restored from private production schema/public-data dumps, validated, and retired.",
      sources: [
        "openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md",
        "docs/ops/2026-05-01-openplan-restore-drill-staging-supabase.md",
      ],
    },
    {
      area: "Final checklist / managed support synchronization",
      status: "PASS",
      evidence:
        "The final pilot-readiness checklist, managed-support proof map, county-run manifest proof, and modeling evidence export proof now travel with both the Admin export and static sales packet.",
      sources: [
        finalPilotReadinessChecklistSync.checklistArtifact,
        ...finalPilotReadinessChecklistSync.latestProofArtifacts.map((artifact) => artifact.artifact),
      ],
    },
  ] satisfies ProofSnapshotRow[],
  onboardingValidationRows: [
    {
      validation: "Name one workspace owner and support contact(s).",
      whyItMatters: "Keeps access, triage, and issue escalation accountable.",
    },
    {
      validation: "Select the first workflow: RTP/report, grants/funding, engagement handoff, analysis/report linkage, county-run evidence packaging, or managed-hosting setup.",
      whyItMatters: "Prevents a buyer conversation from expanding into unsupported full-suite claims.",
    },
    {
      validation: "Classify data sensitivity: public, internal, confidential, or mixed.",
      whyItMatters: "Determines what data belongs in OpenPlan, what should remain outside, and whether enhanced terms are needed.",
    },
    {
      validation: "Confirm the managed-hosting service schedule fields.",
      whyItMatters: "Support targets, backup/restore posture, billing posture, and any enhanced SLA terms must be filled before signature.",
    },
    {
      validation: "Re-run the relevant workspace-specific smoke after setup.",
      whyItMatters: "The May 1/May 10 proof is platform/release evidence; each pilot still needs its own scoped acceptance check.",
    },
    {
      validation: "Confirm Mapbox, Supabase, Vercel, Stripe, and model-provider posture for the chosen workflow.",
      whyItMatters: "Third-party dependencies are part of the hosted operating path and may affect procurement or availability expectations.",
    },
    {
      validation: "Decide whether procurement needs a fresh paid checkout canary.",
      whyItMatters: "The current packet explicitly waives same-cycle money-moving proof.",
    },
    {
      validation: "Review AI/modeling output caveats before external reliance.",
      whyItMatters: "AI-assisted and modeling outputs are planning-support materials, not autonomous or certified decisions.",
    },
    {
      validation: "Confirm client official-record retention outside OpenPlan.",
      whyItMatters: "OpenPlan exports and records do not replace public-records, legal-hold, or official archive duties.",
    },
  ] satisfies OnboardingValidationRow[],
  implementationItemsStillToScope: [
    "buyer-specific data loading, cleanup, geocoding, GIS integration, and source-document review;",
    "SSO, private cloud, agency-cloud deployment, custom security review, or enhanced support/SLA terms;",
    "formal RPO/RTO commitments beyond the signed managed-hosting schedule;",
    "future quarterly restore drills for later production milestones;",
    "fresh same-cycle paid checkout proof if the buyer or procurement reviewer requires it;",
    "calibrated or certified behavioral-demand modeling and broader ActivitySim/MATSim readiness;",
    "no release-wide complete LAPM/legal/compliance automation, grant award prediction, certified grant scoring, or official legal sign-off;",
    "custom reports, integrations, migrations, or planning services beyond the scoped SOW; and",
    "aerial/field evidence workflows beyond the selected implementation scope.",
  ],
  buyerSafeLanguage: {
    use: [
      "OpenPlan supports supervised planning workflows with evidence traceability and human review.",
      "OpenPlan is ready for scoped pilots and managed-service engagements where the first workflow, data posture, support path, and proof boundary are agreed up front.",
      "Managed hosting and implementation are service wrappers around the Apache-2.0 open-source core.",
    ],
    avoid: [
      "Avoid claiming OpenPlan is fully self-serve municipal SaaS.",
      "Avoid claiming OpenPlan replaces planners, engineers, attorneys, grant writers, or agency review.",
      "Avoid claiming OpenPlan predicts grant awards or provides certified grant scoring.",
      "Avoid claiming billing was freshly re-proven with a paid checkout in this release cycle.",
    ],
  } satisfies BuyerSafeLanguage,
  verdict:
    "PASS for buyer-safe packaging: this packet makes the current proof posture readable for a supervised pilot or managed-service sale while preserving the explicit limits around production guarantees, billing proof, modeling, compliance, AI, backup/restore, and buyer-specific onboarding.",
} as const;

export function buildFinalPilotReadinessSyncMarkdown(level: MarkdownHeadingLevel = 2) {
  return [
    heading(level, "Final Pilot-Readiness Checklist Sync"),
    `- Checklist: ${finalPilotReadinessChecklistSync.checklistArtifact}`,
    `- Verdict: ${finalPilotReadinessChecklistSync.verdict}`,
    `- Operator instruction: ${finalPilotReadinessChecklistSync.operatorInstruction}`,
    `- Supervised-onboarding caveat: ${finalPilotReadinessChecklistSync.supervisedOnboardingCaveat}`,
    "",
    heading((level + 1) as MarkdownHeadingLevel, "Exported proof packet filenames"),
    ...finalPilotReadinessChecklistSync.exportFilenames.map((filename) => `- ${filename}`),
    "",
    heading((level + 1) as MarkdownHeadingLevel, "Latest proof lanes synchronized from the final checklist"),
    ...finalPilotReadinessChecklistSync.latestProofArtifacts.flatMap((artifact) => [
      `- **${artifact.label}**: ${artifact.artifact}`,
      `  - Role: ${artifact.role}`,
      `  - Caveat: ${artifact.caveat}`,
    ]),
  ].join("\n");
}

export function buildAdminPilotReadinessProofArtifactIndexMarkdown(level: MarkdownHeadingLevel = 2) {
  return [
    heading(level, "Compact Proof Artifact Index"),
    "Use this index as the short operator map before buyer reliance. It names the current proof packet docs, generated static sales packet files, and preflight proof note without expanding the claim beyond supervised-pilot caveats.",
    "",
    ...markdownTable([
      ["Artifact", "Category", "Buyer-safe caveat"],
      ["---", "---", "---"],
      ...getAdminPilotReadinessProofArtifactIndex().map((item) => [
        `**${item.label}** — \`${item.artifact}\``,
        getAdminPilotReadinessProofArtifactCategoryLabel(item.category),
        item.buyerSafeCaveat,
      ]),
    ]),
  ].join("\n");
}

export function buildReleaseProofAlignmentMarkdown(level: MarkdownHeadingLevel = 2) {
  return [
    heading(level, "Release Proof Packet Alignment"),
    releaseProofPosture.summary,
    releaseProofPosture.wedge,
    "",
    heading((level + 1) as MarkdownHeadingLevel, "Required caveats"),
    ...releaseProofPosture.caveats.map((caveat) => `- ${caveat}`),
    "",
    heading((level + 1) as MarkdownHeadingLevel, "Proof artifacts synchronized with Command Center"),
    ...releaseProofPosture.proofItems.flatMap((item) => [
      `- **${item.label}**: ${item.headline} Source: ${item.artifact}`,
      `  - Supports: ${item.readinessRole}`,
      `  - Operator check: ${item.operatorCheck}`,
      `  - Caveats carried: ${getReleaseProofItemCaveats(item)
        .map((caveat) => `${caveat.label} (${caveat.sourceArtifact})`)
        .join("; ")}`,
    ]),
  ].join("\n");
}

export function buildPilotReadinessPacket(statusList: PilotReadinessPacketStatus[], generatedAt = new Date().toISOString()) {
  const lines = [
    "# Pilot Readiness Evidence Packet",
    `Generated: ${generatedAt}`,
    "",
    "## Current Smoke Status",
    ...statusList.map((s) => `- **${s.lane}**: ${s.status} (Last Run: ${s.lastRun}; Source: ${s.details})`),
    "",
    "## Operator follow-up",
    "- Treat PASS lanes as citeable only when the named source document is available in `docs/ops`.",
    "- Re-run or refresh any FAIL, PENDING, or UNKNOWN lane before using this packet for pilot diligence.",
    "- Treat this packet as an internal diligence aid; buyer-specific emails, public posts, and signed SOW language still need human review.",
    "",
    buildAdminPilotReadinessProofArtifactIndexMarkdown(2),
    "",
    buildFinalPilotReadinessSyncMarkdown(2),
    "",
    buildReleaseProofAlignmentMarkdown(2),
    "",
    "## About OpenPlan Readiness",
    "OpenPlan is actively tested against production infrastructure. These smoke tests reflect the latest validation runs.",
  ];

  return lines.join("\n");
}

export function getAdminPilotReadinessStaticPacketSources() {
  return uniqueStrings([
    ...adminPilotReadinessStaticPacket.proofSnapshotRows.flatMap((row) => [...row.sources]),
    ...releaseProofPosture.proofItems.map((item) => item.artifact),
    ...releaseProofPosture.caveatItems.map((caveat) => caveat.sourceArtifact),
    ...getAdminPilotReadinessProofArtifactIndex().map((item) => item.artifact),
    finalPilotReadinessChecklistSync.checklistArtifact,
    ...finalPilotReadinessChecklistSync.exportFilenames,
    ...finalPilotReadinessChecklistSync.latestProofArtifacts.map((artifact) => artifact.artifact),
    "docs/sales/2026-05-01-openplan-buyer-one-pager.md",
    "docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md",
    "docs/sales/2026-05-01-openplan-managed-hosting-service-description.md",
    "docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md",
    "docs/sales/2026-05-01-openplan-pilot-sow-template.md",
  ]);
}

export function buildAdminPilotReadinessProofPacketMarkdown() {
  const packet = adminPilotReadinessStaticPacket;

  return [
    `# ${packet.title}`,
    "",
    `_Date: ${packet.originalDate}_`,
    `_Last refreshed: ${packet.refreshedDate}_`,
    `_Status: ${packet.status}_`,
    `_Audience: ${packet.audience}_`,
    "",
    "## Buyer-Safe Summary",
    ...packet.buyerSafeSummary.flatMap((paragraph) => [paragraph, ""]),
    "What has been proven for this release-to-sale posture:",
    "",
    ...packet.provenPostureItems.map((item) => `- ${item}`),
    "",
    "## Proof Snapshot",
    ...markdownTable([
      ["Area", "Status", "What the evidence proves", "Source"],
      ["---", "---", "---", "---"],
      ...packet.proofSnapshotRows.map((row) => [row.area, row.status, row.evidence, row.sources.map((source) => `\`${source}\``).join("; ")]),
    ]),
    "",
    buildAdminPilotReadinessProofArtifactIndexMarkdown(2),
    "",
    buildFinalPilotReadinessSyncMarkdown(2),
    "",
    buildReleaseProofAlignmentMarkdown(2),
    "",
    "## What Nat Ford Should Validate During Buyer Onboarding",
    "",
    "Before a rural RTPA/county buyer relies on the pilot workspace, Nat Ford should validate the buyer-specific operating facts below.",
    "",
    ...markdownTable([
      ["Onboarding validation", "Why it matters"],
      ["---", "---"],
      ...packet.onboardingValidationRows.map((row) => [row.validation, row.whyItMatters]),
    ]),
    "",
    "## Implementation-Specific Items Still To Scope",
    "",
    "These items remain real work or engagement-specific decisions, not release-wide guarantees:",
    "",
    ...packet.implementationItemsStillToScope.map((item) => `- ${item}`),
    "",
    "## Buyer-Safe Language",
    "",
    ...packet.buyerSafeLanguage.use.flatMap((language) => ["Use:", "", `> ${language}`, ""]),
    ...packet.buyerSafeLanguage.avoid.flatMap((language) => ["Avoid:", "", `> ${language}`, ""]),
    "## Source Packet Links",
    "",
    ...getAdminPilotReadinessStaticPacketSources().map((source) => `- ${source}`),
    "",
    "## Packet Verdict",
    "",
    packet.verdict,
  ].join("\n");
}
