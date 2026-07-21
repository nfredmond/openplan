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
      "The aerial processing worker is not configured for this deployment: OPENPLAN_AERIAL_PROCESSING_WORKER_URL and/or OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN are unset. Next.js serverless cannot host WebODM / NodeODM itself; processing runs on the Nat Ford Aerial Intel Platform worker.",
    integrationNotes: [
      "The OpenPlan side of natford-aerial-processing.v1 is implemented: this dispatch route POSTs a ProcessingRequest (signed imagery ZIP URL) to the worker's /api/v1/processing-requests, and /api/aerial/processing-callback receives bearer-authenticated ProcessingCallback payloads (accepted/running/succeeded/failed/canceled), tracked in aerial_processing_jobs with a callback idempotency ledger.",
      "A succeeded callback writes an aerial_evidence_packages row from the signed artifact list (orthomosaic/dsm/dtm/point_cloud/mesh); evidence packages remain the canonical audit surface for aerial outputs.",
      "This boundary response is returned only while the worker env vars are unset. No fake/partial processing is performed; callers must not treat it as evidence of processing.",
      "Connecting a deployment requires a running Aerial Intel Platform plus provisioned shared secrets: OPENPLAN_AERIAL_PROCESSING_WORKER_URL, OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN (the platform's AERIAL_EXTERNAL_PROCESSING_TOKEN), and OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN (the platform's AERIAL_PROCESSING_CALLBACK_TOKEN); production must also set OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL to this deployment's public origin.",
    ],
    nextStep:
      "Set OPENPLAN_AERIAL_PROCESSING_WORKER_URL and OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN (plus the callback token and callback URL) per schemas/aerial_processing_contract.schema.json to route this mission's imagery through the Aerial Intel Platform worker.",
  };
}
