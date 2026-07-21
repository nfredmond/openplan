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
      "The worker contract is formalized as natford-aerial-processing.v1 in schemas/aerial_processing_contract.schema.json (committed identically to the aerial-intel-platform repo): OpenPlan POSTs a ProcessingRequest with a signed imagery ZIP URL; the worker POSTs bearer-authenticated ProcessingCallback payloads (accepted/running/succeeded/failed/canceled) to callbackUrl, and a succeeded callback carries signed artifact URLs (orthomosaic/dsm/dtm/point_cloud/mesh) from which the evidence package row is written.",
    ],
    nextStep:
      "Wire the Nat Ford Aerial Intel Platform as the processing worker per schemas/aerial_processing_contract.schema.json: implement the external processing-request endpoint on its side, a callback route on this side that validates ProcessingCallback and writes aerial_evidence_packages rows, and a shared bearer token for both directions.",
  };
}
