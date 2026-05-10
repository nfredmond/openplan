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
    sourceArtifact: "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md",
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
  checklistArtifact: "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md",
  verdict: "PASS for a supervised pilot-readiness conversation; not a launch certificate for a finished planning suite.",
  operatorInstruction:
    "Use this sync block before buyer reliance: confirm the final checklist, exported Admin Pilot Readiness packet filenames, and latest proof-lane artifacts still match the current caveats.",
  supervisedOnboardingCaveat:
    "Onboarding is a supervised implementation step: no instant public workspace activation, no broad self-serve municipal SaaS claim, and no outbound reliance without human review.",
  exportFilenames: [
    "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
    "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html",
    "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf",
  ],
  latestProofArtifacts: [
    {
      label: "Managed support diligence",
      artifact: "docs/sales/2026-05-10-openplan-managed-support-proof-map.md",
      role: "Connects managed hosting, onboarding, support, backup/restore, billing, and pilot closeout claims to proof.",
      caveat: "Buyer-specific reliance checks and per-engagement operations terms still need operator completion before contracting.",
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
      label: "Release proof synchronization",
      artifact: "openplan/src/test/pilot-readiness-export-packet.test.ts",
      role: "Guards the Admin Pilot Readiness export against drift from Command Center release-proof copy and the final smoke checklist.",
      caveat: "Internal packet synchronization does not replace fresh smoke reruns after behavior changes.",
    },
  ],
} satisfies PilotReadinessSyncChecklist;

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
      href: "/admin/pilot-readiness",
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
  ].join("\n");
}
