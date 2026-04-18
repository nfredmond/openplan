export type OdmProcessingBoundary = {
  schemaVersion: "natford-odm-stub-1";
  status: "not-implemented";
  reason: string;
  integrationNotes: string[];
  nextStep: string;
};

export function buildOdmProcessingBoundary(): OdmProcessingBoundary {
  return {
    schemaVersion: "natford-odm-stub-1",
    status: "not-implemented",
    reason:
      "ODM (imagery → ortho/DSM) processing is not wired into OpenPlan runtime. Next.js serverless cannot host WebODM / NodeODM; that requires a dedicated processing worker with GPU-optional disk.",
    integrationNotes: [
      "Consuming integrations will post imagery bundles to the processing worker; OpenPlan will store worker callbacks against the mission.",
      "No fake/partial processing is performed by this endpoint. Callers must not treat 202 responses as evidence of processing.",
      "Evidence package creation remains the canonical audit surface for aerial outputs (see aerial_evidence_packages).",
    ],
    nextStep:
      "Stand up a WebODM or Pix4D worker, expose it behind an authenticated queue, and have it write aerial_evidence_packages rows on completion.",
  };
}
