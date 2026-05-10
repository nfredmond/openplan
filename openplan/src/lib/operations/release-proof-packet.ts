export type ReleaseProofStatus = "pass" | "caveat" | "next";

export type ReleaseProofItem = {
  key: string;
  label: string;
  status: ReleaseProofStatus;
  headline: string;
  detail: string;
  artifact: string;
};

export type ReleaseProofAction = {
  label: string;
  href: string;
  detail: string;
};

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
    },
    {
      key: "readiness-export",
      label: "Packet",
      status: "pass",
      headline: "Admin Pilot Readiness is the operator-facing packet check.",
      detail:
        "Operators should use the readiness surface before external demos so smoke evidence, missing proof rows, and operational warnings are visible in one place.",
      artifact: "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
    },
    {
      key: "sales-caveats",
      label: "Caveats",
      status: "caveat",
      headline: "Sales language must stay inside named caveats.",
      detail:
        "No fresh same-cycle paid canary is claimed; onboarding remains supervised; RPO/RTO commitments are set per engagement; modeling and LAPM/legal claims stay behind explicit proof gates.",
      artifact: "docs/ops/2026-05-01-openplan-known-issues-register.md",
    },
    {
      key: "next-operator-action",
      label: "Next action",
      status: "next",
      headline: "Inspect readiness, then review intake positioning.",
      detail:
        "If the readiness packet is clean, compare request-access and examples copy against the caveat sheet before using the release packet in a buyer conversation.",
      artifact: "docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md",
    },
  ] satisfies ReleaseProofItem[],
  caveats: [
    "No fresh same-cycle paid canary is claimed; current billing proof is waiver/non-money-moving posture.",
    "Onboarding remains a supervised implementation step, not instant self-serve activation.",
    "RPO/RTO commitments are filled per managed-hosting engagement, not promised globally here.",
    "Modeling outputs support planning review only inside the current proof boundary; no validated behavioral forecasting claim is made.",
    "OpenPlan is not sold as legal-grade LAPM/compliance automation or autonomous AI planning.",
  ],
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

export function releaseProofCopyBlock() {
  return [
    releaseProofPosture.summary,
    releaseProofPosture.wedge,
    ...releaseProofPosture.proofItems.flatMap((item) => [item.headline, item.detail, item.artifact]),
    ...releaseProofPosture.caveats,
    ...releaseProofPosture.actions.flatMap((action) => [action.label, action.href, action.detail]),
  ].join("\n");
}
