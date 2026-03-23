import { describe, expect, it } from "vitest";
import {
  canLabelAsLapmReady,
  getOperatorControlProfileByEvidenceId,
  getStageGateOperatorControls,
  mustTreatAsDeferredOrInternalOnly,
} from "@/lib/stage-gates/operator-controls";

describe("stage-gate operator controls", () => {
  it("exposes the PM/invoicing control pack and critical evidence profiles", () => {
    const controls = getStageGateOperatorControls();

    expect(controls.control_pack_id).toBe("lapm_pm_invoicing_controls_v0_1");
    expect(controls.profiles.length).toBeGreaterThanOrEqual(5);

    const finalInvoiceProfile = getOperatorControlProfileByEvidenceId("G09_E03");
    expect(finalInvoiceProfile?.profile_id).toBe("g09_e03_final_invoice_closeout");
    expect(finalInvoiceProfile?.operator_fields.some((field) => field.key === "final_cost_reconciliation_complete")).toBe(true);

    const protocolProfile = getOperatorControlProfileByEvidenceId("G02_E04");
    expect(protocolProfile?.profile_id).toBe("g02_e04_invoice_controls_protocol");
  });

  it("blocks LAPM-ready labeling when citation or review discipline is incomplete", () => {
    expect(
      canLabelAsLapmReady({
        hasExactCitation: false,
        hasRevisionDate: true,
        hasSourceUrl: true,
        evidenceApproved: true,
        workflowStatus: "approved",
        lapmReadinessStatus: "lapm_ready",
        unresolvedPolicyDelta: false,
        unresolvedExceptions: false,
        reviewRequired: true,
        reviewComplete: true,
      })
    ).toBe(false);

    expect(
      canLabelAsLapmReady({
        hasExactCitation: true,
        hasRevisionDate: true,
        hasSourceUrl: true,
        evidenceApproved: true,
        workflowStatus: "approved",
        lapmReadinessStatus: "lapm_ready",
        unresolvedPolicyDelta: false,
        unresolvedExceptions: false,
        reviewRequired: true,
        reviewComplete: false,
      })
    ).toBe(false);
  });

  it("allows LAPM-ready labeling only when all control checks pass", () => {
    expect(
      canLabelAsLapmReady({
        hasExactCitation: true,
        hasRevisionDate: true,
        hasSourceUrl: true,
        evidenceApproved: true,
        workflowStatus: "approved",
        lapmReadinessStatus: "lapm_ready",
        unresolvedPolicyDelta: false,
        unresolvedExceptions: false,
        reviewRequired: true,
        reviewComplete: true,
      })
    ).toBe(true);
  });

  it("forces deferred/internal-only treatment when core readiness conditions are missing", () => {
    expect(
      mustTreatAsDeferredOrInternalOnly({
        hasPlaceholders: true,
        exactFormApplicabilityResolved: true,
        projectPhaseEvidenceReady: true,
        paymentOrCloseoutSupportReady: true,
      })
    ).toBe(true);

    expect(
      mustTreatAsDeferredOrInternalOnly({
        hasPlaceholders: false,
        exactFormApplicabilityResolved: true,
        projectPhaseEvidenceReady: true,
        paymentOrCloseoutSupportReady: true,
      })
    ).toBe(false);
  });
});
