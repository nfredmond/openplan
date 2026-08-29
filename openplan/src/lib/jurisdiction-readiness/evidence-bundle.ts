import { createHash } from "node:crypto";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import type { GeneratedProjectEvidenceFile } from "@/lib/project-evidence-bundles/archive";
import { buildJurisdictionReadinessPayload } from "./payload";

type ProjectJurisdictionRow = {
  id: string;
  place_label?: string | null;
  place_country_code?: string | null;
  place_subdivision_code?: string | null;
};

/** Freeze the same project readiness payload exposed by the UI and API. */
export function buildJurisdictionReadinessEvidenceFile(
  project: ProjectJurisdictionRow,
  registrySha256: string,
): GeneratedProjectEvidenceFile {
  const payload = buildJurisdictionReadinessPayload(
    {
      countryCode: project.place_country_code ?? null,
      subdivisionCode: project.place_subdivision_code ?? null,
      label: project.place_label ?? null,
    },
    registrySha256,
  );
  const canonical = canonicalizeActionPayload(payload);
  return {
    path: "project/jurisdiction-readiness.json",
    recordId: project.id,
    title: "Jurisdiction readiness at handoff",
    sourceId: "jurisdiction_readiness",
    owningModule: "projects",
    bytes: Buffer.from(`${canonical}\n`, "utf8"),
    contentType: "application/json",
    retrievalState: "rendered_on_freeze",
    custodyState: "rendered_on_freeze",
    knownLimits: [
      "This records OpenPlan's evidence-backed coverage at bundle time. It is not a legal determination or a promise that an unassessed job is supported.",
    ],
    revisionToken: createHash("sha256").update(canonical).digest("hex"),
  };
}
