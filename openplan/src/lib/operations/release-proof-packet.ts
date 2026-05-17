import {
  ADMIN_PILOT_READINESS_ROUTE,
  ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT,
  ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS,
  FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
  PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
  WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT,
} from "@/lib/operations/pilot-readiness-proof-paths";
import { SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT } from "@/lib/operations/supervised-onboarding-evidence";

export type ReleaseProofStatus = "pass" | "caveat" | "next";

export type ReleaseProofItem = {
  key: string;
  label: string;
  status: ReleaseProofStatus;
  headline: string;
  detail: string;
  artifact: string;
  readinessRole: string;
  operatorCheck: string;
  caveatKeys: readonly ReleaseProofCaveatKey[];
};

export type ReleaseProofCaveatKey =
  | "billing-waiver"
  | "supervised-onboarding"
  | "hosting-rpo-rto"
  | "modeling-boundary"
  | "lapm-ai-boundary";

export type ReleaseProofCaveat = {
  key: ReleaseProofCaveatKey;
  label: string;
  text: string;
  sourceArtifact: string;
};

export type ReleaseProofAction = {
  label: string;
  href: string;
  detail: string;
};

export type PilotReadinessSyncArtifact = {
  label: string;
  artifact: string;
  role: string;
  caveat: string;
};

export type PilotReadinessSyncChecklist = {
  label: string;
  checklistArtifact: string;
  verdict: string;
  operatorInstruction: string;
  supervisedOnboardingCaveat: string;
  exportFilenames: readonly string[];
  latestProofArtifacts: readonly PilotReadinessSyncArtifact[];
};

export type AdminPilotReadinessProofArtifactCategory =
  | "proof-packet-doc"
  | "static-sales-packet"
  | "preflight-proof";

export type AdminPilotReadinessProofArtifactIndexItem = {
  key: string;
  label: string;
  category: AdminPilotReadinessProofArtifactCategory;
  artifact: string;
  buyerSafeCaveat: string;
  operatorUse: string;
};

export type AdminPilotReadinessProofHubStep = {
  key: string;
  order: number;
  label: string;
  operatorAction: string;
  evidenceAnchor: string;
  citeOnly: string;
  stopCondition: string;
  artifact: string;
};

export const releaseProofCaveatItems = [
  {
    key: "billing-waiver",
    label: "Billing proof waiver",
    text: "No fresh same-cycle paid canary is claimed; current billing proof is waiver/non-money-moving posture.",
    sourceArtifact: "docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md",
  },
  {
    key: "supervised-onboarding",
    label: "Supervised onboarding",
    text: "Onboarding remains a supervised implementation step, not instant self-serve activation; buyer use requires operator review before reliance.",
    sourceArtifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
  },
  {
    key: "hosting-rpo-rto",
    label: "Per-engagement hosting terms",
    text: "RPO/RTO commitments are filled per managed-hosting engagement, not promised globally here.",
    sourceArtifact: "docs/ops/2026-05-01-openplan-known-issues-register.md",
  },
  {
    key: "modeling-boundary",
    label: "Modeling proof boundary",
    text: "Modeling outputs support planning review only inside the current proof boundary; no validated behavioral forecasting claim is made.",
    sourceArtifact: "docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md",
  },
  {
    key: "lapm-ai-boundary",
    label: "No legal/autonomous AI claim",
    text: "OpenPlan is not sold as legal-grade LAPM/compliance automation or autonomous AI planning, and no grant award prediction claim is made.",
    sourceArtifact: "docs/ops/2026-05-01-openplan-known-issues-register.md",
  },
] satisfies ReleaseProofCaveat[];

export const finalPilotReadinessChecklistSync = {
  label: "Final pilot-readiness checklist sync",
  checklistArtifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
  verdict: "PASS for a supervised pilot-readiness conversation; not a launch certificate for a finished planning suite.",
  operatorInstruction:
    "Use this sync block before buyer reliance: confirm the final checklist, exported Admin Pilot Readiness packet filenames, and latest proof-lane artifacts still match the current caveats.",
  supervisedOnboardingCaveat:
    "Onboarding is a supervised implementation step: no instant public workspace activation, no broad self-serve municipal SaaS claim, and no outbound reliance without human review.",
  exportFilenames: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS,
  latestProofArtifacts: [
    {
      label: "Managed support diligence",
      artifact: "docs/sales/2026-05-10-openplan-managed-support-proof-map.md",
      role: "Connects managed hosting, onboarding, support, backup/restore, billing, and pilot closeout claims to proof.",
      caveat: "Buyer-specific reliance checks and per-engagement operations terms still need operator completion before contracting.",
    },
    {
      label: "Supervised onboarding evidence bridge",
      artifact: SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT,
      role: "Connects request-access intake, Admin Operations review, manual no-email provisioning, and Pilot Readiness caveats in one proof chain.",
      caveat: "This is operator evidence only; it is not public self-serve activation, outbound email automation, or permission to provision during a smoke.",
    },
    {
      label: "County-run manifest proof",
      artifact: "docs/ops/2026-05-10-openplan-county-run-manifest-proof-ui.md",
      role: "Keeps county-run evidence, source context, and caveats visible for pilot diligence.",
      caveat: "County-run output is evidence packaging, not validated forecasting or autonomous decision support.",
    },
    {
      label: "Modeling evidence exports",
      artifact: "openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md",
      role: "Carries modeling caveats and source context into report and RTP export paths.",
      caveat: "Behavioral-onramp KPIs remain behind the proven SQL/RPC caveat gate; no validated behavioral forecasting claim is made.",
    },
    {
      label: "Wave 6 release-readiness summary",
      artifact: WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT,
      role: "Summarizes the May 10 proof/readiness merge train, validation posture, caveats, and merge risk for operator review.",
      caveat: "Use as a discoverability summary only; it is not a launch certificate or a substitute for fresh preflight before buyer reliance.",
    },
    {
      label: "Release proof synchronization",
      artifact: "openplan/src/test/pilot-readiness-export-packet.test.ts",
      role: "Guards the Admin Pilot Readiness export against drift from Command Center release-proof copy and the final smoke checklist.",
      caveat: "Internal packet synchronization does not replace fresh smoke reruns after behavior changes.",
    },
  ],
} satisfies PilotReadinessSyncChecklist;

export const adminPilotReadinessProofArtifactIndex = [
  {
    key: "final-checklist",
    label: "Final pilot-readiness checklist",
    category: "proof-packet-doc",
    artifact: finalPilotReadinessChecklistSync.checklistArtifact,
    buyerSafeCaveat:
      "PASS supports a supervised pilot-readiness conversation only; it is not a finished-suite launch certificate.",
    operatorUse: "Start here to confirm the current checklist verdict, caveat boundary, and named source docs.",
  },
  {
    key: "managed-support-proof-map",
    label: "Managed support proof map",
    category: "proof-packet-doc",
    artifact: "docs/sales/2026-05-10-openplan-managed-support-proof-map.md",
    buyerSafeCaveat:
      "Managed hosting, support, backup/restore, and pilot-closeout claims still require buyer-specific scope and terms.",
    operatorUse: "Use before discussing managed service commitments or SOW-ready hosting language.",
  },
  {
    key: "export-source-trace",
    label: "Pilot-readiness export source trace",
    category: "proof-packet-doc",
    artifact: "openplan/docs/ops/2026-05-09-pilot-readiness-export-source-trace-proof.md",
    buyerSafeCaveat:
      "Export traceability proves packet construction, not a fresh production smoke after later behavior changes.",
    operatorUse: "Use when validating that the Admin export surface is still tied to reusable proof helpers.",
  },
  {
    key: "static-markdown",
    label: "Static sales packet — Markdown",
    category: "static-sales-packet",
    artifact: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.markdown,
    buyerSafeCaveat:
      "Buyer-facing packet copy must travel with the caveat sheet and human review before external reliance.",
    operatorUse: "Use as the editable source-style sales packet for diligence review.",
  },
  {
    key: "static-html",
    label: "Static sales packet — HTML",
    category: "static-sales-packet",
    artifact: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.html,
    buyerSafeCaveat:
      "HTML is a generated presentation artifact; regenerate it when the Markdown/source helpers change.",
    operatorUse: "Use for browser-readable packet review or lightweight sharing after caveat review.",
  },
  {
    key: "static-pdf",
    label: "Static sales packet — PDF",
    category: "static-sales-packet",
    artifact: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.pdf,
    buyerSafeCaveat:
      "PDF is a generated snapshot; do not treat it as current if the proof helpers or checklist changed afterward.",
    operatorUse: "Use as the fixed packet attachment only after confirming it matches the current generated packet.",
  },
  {
    key: "wave6-release-readiness-summary",
    label: "Wave 6 release-readiness summary",
    category: "proof-packet-doc",
    artifact: WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT,
    buyerSafeCaveat:
      "Summary supports operator orientation for the May 10 merge train only; it is not a broad launch-readiness certificate.",
    operatorUse: "Use after the final checklist to find the shipped proof/readiness changes, validation posture, caveats, and merge risk in one place.",
  },
  {
    key: "pilot-preflight-proof",
    label: "Pilot preflight operator proof",
    category: "preflight-proof",
    artifact: PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
    buyerSafeCaveat:
      "The preflight is read-only operational confidence, not self-serve activation, schema approval, or production-write proof.",
    operatorUse: "Run or cite the preflight pattern immediately before serious buyer, demo, or pilot reliance.",
  },
] satisfies AdminPilotReadinessProofArtifactIndexItem[];

export const adminPilotReadinessProofHubSteps = [
  {
    key: "confirm-boundary",
    order: 1,
    label: "Confirm the proof boundary first",
    operatorAction:
      "Start with the final checklist and caveat sheet before reading individual PASS rows or preparing buyer language.",
    evidenceAnchor: "Final checklist verdict, required caveats, and source artifact list.",
    citeOnly:
      "A supervised pilot-readiness conversation for a scoped workbench; not finished-suite, legal, forecasting, or autonomous readiness.",
    stopCondition:
      "Stop if a claim needs self-serve activation, legal-grade LAPM automation, grant prediction, or validated behavioral forecasting.",
    artifact: finalPilotReadinessChecklistSync.checklistArtifact,
  },
  {
    key: "inspect-source-docs",
    order: 2,
    label: "Inspect source docs, not dashboard summaries",
    operatorAction:
      "Open the proof map and exact artifact paths before citing a lane in demo notes, SOW language, or a diligence packet.",
    evidenceAnchor: "Named proof artifacts and operator-use notes in the compact index.",
    citeOnly: "The source document and its stated caveat; never cite this admin page as the evidence itself.",
    stopCondition: "Stop if the source artifact is stale, missing, or only describes planned work.",
    artifact: "docs/sales/2026-05-10-openplan-managed-support-proof-map.md",
  },
  {
    key: "compare-export-formats",
    order: 3,
    label: "Compare static packet formats",
    operatorAction:
      "Use Markdown for edits, HTML for browser review, and PDF only as a generated snapshot after caveat review.",
    evidenceAnchor: "Generated Admin Pilot Readiness packet filenames.",
    citeOnly: "Packet copy that still matches the current helper data, final checklist, and caveat list.",
    stopCondition: "Stop and regenerate if helper copy, checklist posture, or caveats changed after the static exports.",
    artifact: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.markdown,
  },
  {
    key: "run-read-only-preflight",
    order: 4,
    label: "Run read-only preflight before reliance",
    operatorAction:
      "Run the terminal preflight immediately before a serious buyer call, demo, or pilot handoff; do not run writes from this page.",
    evidenceAnchor: "Preflight command, proof note, ATTENTION handling, and no-write boundary.",
    citeOnly: "Operational confidence from read-only checks; not deployment approval or production mutation proof.",
    stopCondition: "Stop if the preflight reports FAIL/ATTENTION that affects the intended buyer claim.",
    artifact: PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
  },
  {
    key: "record-next-human-review",
    order: 5,
    label: "Record the next human review checkpoint",
    operatorAction:
      "After the packet is clean, name the owner who will verify buyer-specific data, support terms, and pilot acceptance checks.",
    evidenceAnchor: "Buyer-specific onboarding validation, managed-support map, and wave summary.",
    citeOnly: "Scoped pilot readiness after human review, not automatic customer activation.",
    stopCondition: "Stop if the buyer-specific workflow, data sensitivity, support path, or acceptance smoke is still undecided.",
    artifact: WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT,
  },
] satisfies AdminPilotReadinessProofHubStep[];

export function getAdminPilotReadinessProofHubSteps() {
  return adminPilotReadinessProofHubSteps;
}

export function getAdminPilotReadinessProofArtifactIndex() {
  return adminPilotReadinessProofArtifactIndex;
}

export function getAdminPilotReadinessProofArtifactCategoryLabel(
  category: AdminPilotReadinessProofArtifactCategory,
) {
  if (category === "proof-packet-doc") return "Proof packet doc";
  if (category === "static-sales-packet") return "Static sales packet";
  return "Preflight proof";
}


export const buyerDemoCommandCenterHandoff = {
  label: "Buyer demo handoff",
  headline: "Run the buyer demo from proof, then intake, then examples.",
  detail:
    "Use Command Center as the internal launch rail: inspect pilot readiness, confirm request-access boundaries, and only then open buyer examples for the supervised story.",
  boundary:
    "No production writes, provisioning, outbound email, checkout, or self-serve activation are implied by this handoff.",
  steps: [
    {
      label: "1. Readiness packet",
      href: ADMIN_PILOT_READINESS_ROUTE,
      detail: "Confirm final checklist, latest preflight proof, and caveat sheet before demo language leaves the room.",
    },
    {
      label: "2. Request access",
      href: "/request-access",
      detail: "Verify intake copy still says triaged/supervised and does not promise automatic access, billing, or support.",
    },
    {
      label: "3. Examples",
      href: "/examples",
      detail: "Use examples only after the proof boundary is clean; keep claims scoped to the current rural planning workbench wedge.",
    },
  ],
} as const;

export const releaseProofPosture = {
  label: "Release proof packet",
  title: "Proof posture for supervised release review",
  summary:
    "OpenPlan is inspectable as an Apache-2.0 planning workbench plus Nat Ford managed hosting, onboarding, implementation, support, and planning services.",
  wedge:
    "Sell the current wedge as supervised planning workbench support for rural RTPA/county workflows, not broad self-serve municipal SaaS.",
  proofItems: [
    {
      key: "release-gates",
      label: "Gates",
      status: "pass",
      headline: "Release gates are collected and traceable.",
      detail:
        "The release-to-sale plan records PASS posture for proof repair, RC baseline, workspace isolation, RTP, grants, engagement, analysis, admin/support, billing posture, and restore-drill evidence.",
      artifact: "docs/ops/2026-05-01-openplan-release-to-sale-plan.md",
      readinessRole: "Sale readiness: names the current gate evidence operators may cite for the supervised offer.",
      operatorCheck:
        "Use it to confirm a buyer or pilot claim maps to a PASS gate before it appears in demo copy, SOW language, or a readiness packet.",
      caveatKeys: ["supervised-onboarding", "modeling-boundary", "lapm-ai-boundary"],
    },
    {
      key: "readiness-export",
      label: "Packet",
      status: "pass",
      headline: "Admin Pilot Readiness is the operator-facing packet check.",
      detail:
        "Operators should use the readiness surface before external demos so smoke evidence, missing proof rows, and operational warnings are visible in one place.",
      artifact: "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
      readinessRole: "Pilot readiness: turns smoke status and source documents into a reviewable operator packet.",
      operatorCheck:
        "Use it immediately before a pilot demo to verify PASS lanes have named source docs and every pending/failing lane has a follow-up owner.",
      caveatKeys: ["billing-waiver", "supervised-onboarding", "hosting-rpo-rto"],
    },
    {
      key: "sales-caveats",
      label: "Caveats",
      status: "caveat",
      headline: "Sales language must stay inside named caveats.",
      detail:
        "No fresh same-cycle paid canary is claimed; onboarding remains supervised; RPO/RTO commitments are set per engagement; modeling and LAPM/legal claims stay behind explicit proof gates.",
      artifact: "docs/ops/2026-05-01-openplan-known-issues-register.md",
      readinessRole: "Sale readiness: keeps public, pricing, and buyer-facing language inside the current proof boundary.",
      operatorCheck:
        "Use it as the stop-list before sharing examples, pricing language, implementation scopes, or managed-hosting commitments.",
      caveatKeys: [
        "billing-waiver",
        "supervised-onboarding",
        "hosting-rpo-rto",
        "modeling-boundary",
        "lapm-ai-boundary",
      ],
    },
    {
      key: "next-operator-action",
      label: "Next action",
      status: "next",
      headline: "Inspect readiness, then review intake positioning.",
      detail:
        "If the readiness packet is clean, compare request-access and examples copy against the caveat sheet before using the release packet in a buyer conversation.",
      artifact: "docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md",
      readinessRole: "Sale and pilot readiness: gives the operator sequence after proof review, before external use.",
      operatorCheck:
        "Use it as the final supervised-readiness walk-through: readiness packet, request-access language, examples, then buyer-safe caveat sheet.",
      caveatKeys: ["billing-waiver", "supervised-onboarding", "modeling-boundary", "lapm-ai-boundary"],
    },
  ] satisfies ReleaseProofItem[],
  caveatItems: releaseProofCaveatItems,
  caveats: releaseProofCaveatItems.map((caveat) => caveat.text),
  actions: [
    {
      label: "Open readiness packet",
      href: ADMIN_PILOT_READINESS_ROUTE,
      detail: "Check smoke evidence and missing proof rows before external use.",
    },
    {
      label: "Review request access",
      href: "/request-access",
      detail: "Confirm service-intake language still matches supervised onboarding.",
    },
    {
      label: "Review examples",
      href: "/examples",
      detail: "Confirm buyer examples do not exceed the current proof packet.",
    },
  ] satisfies ReleaseProofAction[],
} as const;

export function getReleaseProofItemCaveats(item: ReleaseProofItem): ReleaseProofCaveat[] {
  return item.caveatKeys
    .map((key) => releaseProofCaveatItems.find((caveat) => caveat.key === key))
    .filter((caveat): caveat is ReleaseProofCaveat => Boolean(caveat));
}

export function releaseProofCopyBlock() {
  return [
    releaseProofPosture.summary,
    releaseProofPosture.wedge,
    finalPilotReadinessChecklistSync.label,
    finalPilotReadinessChecklistSync.checklistArtifact,
    finalPilotReadinessChecklistSync.verdict,
    finalPilotReadinessChecklistSync.operatorInstruction,
    finalPilotReadinessChecklistSync.supervisedOnboardingCaveat,
    ...finalPilotReadinessChecklistSync.exportFilenames,
    ...finalPilotReadinessChecklistSync.latestProofArtifacts.flatMap((artifact) => [
      artifact.label,
      artifact.artifact,
      artifact.role,
      artifact.caveat,
    ]),
    ...releaseProofPosture.proofItems.flatMap((item) => [
      item.headline,
      item.detail,
      item.artifact,
      item.readinessRole,
      item.operatorCheck,
      ...getReleaseProofItemCaveats(item).map((caveat) => `${caveat.label}: ${caveat.text}`),
    ]),
    ...releaseProofPosture.caveatItems.flatMap((caveat) => [caveat.label, caveat.text, caveat.sourceArtifact]),
    ...releaseProofPosture.actions.flatMap((action) => [action.label, action.href, action.detail]),
    buyerDemoCommandCenterHandoff.label,
    buyerDemoCommandCenterHandoff.headline,
    buyerDemoCommandCenterHandoff.detail,
    buyerDemoCommandCenterHandoff.boundary,
    ...buyerDemoCommandCenterHandoff.steps.flatMap((step) => [step.label, step.href, step.detail]),
  ].join("\n");
}
