/** AUTHORED, UNEXECUTED. Byte/schema controls do not establish native custody. */
import { describe,expect,it } from "vitest";
import { createHash } from "node:crypto";
import { buildSafetyComparisonSnapshot,readSafetyArtifactSnapshot,readSafetyComparisonRecord } from "@/lib/reports/safety-comparison-snapshot";
import { readSafetyPlanSnapshot,safetySeedHash,SAFETY_SNAPSHOT_V1_ACQUISITION_PROJECTION } from "@/lib/reports/safety-plan-snapshot";
import { safetySeedFixture } from "./fixtures/grants/safety-seed";
import { comparisonFixture,comparisonId,comparisonRevision,rehashComparison } from "./fixtures/safety/comparison";
import { sameSafetyRevision } from "@/lib/reports/safety-revision";
function frozen(){const comparison=comparisonFixture();return buildSafetyComparisonSnapshot({comparison,artifactId:comparisonId(7),reportId:comparison.report_id,workspaceId:comparison.workspace_id,projectId:comparison.project_id,generatedAt:comparisonRevision,reportUpdatedAt:comparisonRevision,projectUpdatedAt:comparisonRevision});}
describe("Safety v1/v2 immutable discrimination",()=>{
 it("preserves a microsecond and accepts an equivalent timezone spelling",()=>{
  expect(sameSafetyRevision(comparisonRevision,"2026-10-19T05:00:00.123456-07:00")).toBe(true);
  expect(sameSafetyRevision(comparisonRevision,"2026-10-19T12:00:00.123455+00:00")).toBe(false);
 });
 it("leaves legacy bytes/hash and acquisition keys unchanged",()=>{
  const legacy=safetySeedFixture().artifact.metadata_json.safetyPlanSnapshotV1;const bytes=JSON.stringify(legacy);
  expect(readSafetyArtifactSnapshot({safetyPlanSnapshotV1:legacy}).kind).toBe("v1");expect(JSON.stringify(legacy)).toBe(bytes);
  expect(readSafetyPlanSnapshot(legacy)).not.toBeNull();expect(SAFETY_SNAPSHOT_V1_ACQUISITION_PROJECTION).not.toContain("evidence_revision");
 });
 it("accepts reordered JSON objects but refuses changed consumed values and dropped projections",()=>{
  const row=comparisonFixture();expect(readSafetyComparisonRecord({...row,payload:{...row.payload}})).not.toBeNull();
  expect(readSafetyComparisonRecord({...row,content_hash:"f".repeat(64)})).toBeNull();
  row.payload.inputs.siteLabel="Changed after hashing";expect(readSafetyComparisonRecord(row)).toBeNull();
  rehashComparison(row);row.payload.capture.projection.pop();rehashComparison(row);expect(readSafetyComparisonRecord(row)).toBeNull();
 });
 it("recognizes v2, refuses dual keys, wrong version, ownership and old v1 fallback",()=>{
  const snapshot=frozen();expect(readSafetyArtifactSnapshot({safetyPlanSnapshotV2:snapshot}).kind).toBe("v2");
  expect(readSafetyArtifactSnapshot({safetyPlanSnapshotV1:safetySeedFixture().artifact.metadata_json.safetyPlanSnapshotV1,safetyPlanSnapshotV2:snapshot}).kind).toBe("invalid");
  expect(readSafetyArtifactSnapshot({safetyPlanSnapshotV3:snapshot}).kind).toBe("invalid");
  const {hash:oldHash,...versioned}=snapshot;expect(oldHash).toHaveLength(64);const unknownVersion={...versioned,version:"v99"};
  expect(readSafetyArtifactSnapshot({safetyPlanSnapshotV2:{...unknownVersion,hash:safetySeedHash(unknownVersion)}}).kind).toBe("invalid");
  const {hash:unused,...payload}=snapshot;expect(unused).toHaveLength(64);const wrong={...payload,projectId:comparisonId(99)};
  expect(readSafetyArtifactSnapshot({safetyPlanSnapshotV2:{...wrong,hash:safetySeedHash(wrong)}}).kind).toBe("invalid");
 });
 it("rejects person-unit promotion even with a recomputed byte hash",()=>{
  const row=comparisonFixture();const payload={...row.payload,capture:{...row.payload.capture,unit:"person"}};
  const content_text=JSON.stringify(payload);const content_hash=createHash("sha256").update(content_text).digest("hex");
  expect(readSafetyComparisonRecord({...row,payload,content_text,content_hash})).toBeNull();
 });
});
