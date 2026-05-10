import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ReleaseProofPacketPanel } from "@/components/operations/release-proof-packet-panel";
import { releaseProofCopyBlock, releaseProofPosture } from "@/lib/operations/release-proof-packet";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ReleaseProofPacketPanel", () => {
  it("surfaces current proof posture, artifacts, caveats, and operator actions", () => {
    render(<ReleaseProofPacketPanel />);

    expect(screen.getByRole("heading", { name: /Proof posture for supervised release review/i })).toBeInTheDocument();
    expect(screen.getByText(/Apache-2\.0 planning workbench plus Nat Ford managed hosting/i)).toBeInTheDocument();
    expect(screen.getByText(/not broad self-serve municipal SaaS/i)).toBeInTheDocument();

    expect(screen.getByText(/Release gates are collected and traceable/i)).toBeInTheDocument();
    expect(screen.getByText(/Admin Pilot Readiness is the operator-facing packet check/i)).toBeInTheDocument();
    expect(screen.getByText("docs/ops/2026-05-01-openplan-release-to-sale-plan.md")).toBeInTheDocument();
    expect(screen.getByText("docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md")).toBeInTheDocument();

    expect(screen.getAllByText(/No fresh same-cycle paid canary is claimed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Onboarding remains a supervised implementation step/i)).toBeInTheDocument();
    expect(screen.getByText(/RPO\/RTO commitments are filled per managed-hosting engagement/i)).toBeInTheDocument();
    expect(screen.getByText(/no validated behavioral forecasting claim is made/i)).toBeInTheDocument();
    expect(screen.getByText(/not sold as legal-grade LAPM\/compliance automation or autonomous AI planning/i)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Open readiness packet/i })).toHaveAttribute(
      "href",
      "/admin/pilot-readiness"
    );
    expect(screen.getByRole("link", { name: /Review request access/i })).toHaveAttribute("href", "/request-access");
    expect(screen.getByRole("link", { name: /Review examples/i })).toHaveAttribute("href", "/examples");
  });

  it("keeps required release caveats in the reusable copy block", () => {
    const copyBlock = releaseProofCopyBlock();

    expect(releaseProofPosture.proofItems).toHaveLength(4);
    expect(copyBlock).toContain("No fresh same-cycle paid canary is claimed");
    expect(copyBlock).toContain("Onboarding remains");
    expect(copyBlock).toContain("RPO/RTO commitments");
    expect(copyBlock).toContain("no validated behavioral forecasting claim");
    expect(copyBlock).toContain("legal-grade LAPM/compliance automation");
  });
});
