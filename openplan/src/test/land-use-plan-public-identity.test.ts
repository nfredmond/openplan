import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashFrozenRecord, type FrozenPlanContent } from "@/lib/land-use-plans/versioning";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const database = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  errors: new Set<string>(),
  queries: [] as Array<{ table: string; projection: string; filters: unknown[][] }>,
  rpcCalls: [] as unknown[][],
  extraDecisions: [] as Array<Record<string, unknown>>,
  publicationOverride: undefined as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({
  async rpc(name: string, args: unknown) {
    database.rpcCalls.push([name, args]);
    if (database.errors.size) return { data: null, error: { message: "Synthetic read failure" } };
    return { data: database.publicationOverride === undefined ? publicationSource() : database.publicationOverride, error: null };
  },
  from(table: string) {
    const query = { table, projection: "", filters: [] as unknown[][] };
    database.queries.push(query);
    const chain = {
      select(columns: string) { query.projection = columns; return chain; },
      eq(column: string, value: unknown) { query.filters.push(["eq", column, value]); return chain; },
      neq(column: string, value: unknown) { query.filters.push(["neq", column, value]); return chain; },
      not(column: string, operator: string, value: unknown) { query.filters.push(["not", column, operator, value]); return chain; },
      order() { return chain; }, limit() { return chain; },
      async maybeSingle() {
        if (database.errors.has(table)) return { data: null, error: { message: "Synthetic read failure" } };
        const row = database.rows[table];
        // Return only requested columns so an omitted identity or hash cannot pass.
        return { data: row ? Object.fromEntries(query.projection.split(",").map(key => key.trim()).map(key => [key, row[key]])) : null, error: null };
      },
    };
    return chain;
  },
}) }));

import { loadPublishedLandUsePlanPacket, loadPublicLandUsePlanReviewPacket } from "@/lib/land-use-plans/public";

const planId = "10000000-0000-4000-8000-000000000001";
const versionId = "10000000-0000-4000-8000-000000000002";
const otherId = "10000000-0000-4000-8000-000000000003";
const shareToken = "synthetic-review-token";
let frozen: FrozenPlanContent;

/** Synthetic statement result. SQL scope, hashing and locking need native evidence. */
function publicationSource() {
  const native = database.rows.land_use_plan_decisions;
  const manifest = { planId, versionId, versionContentHash: native.version_content_hash, reviewReleaseId: otherId,
    reviewOutcomeHash: "c".repeat(64), supportingDocuments: [{ id: otherId, title: "Retained evidence" }],
    decision: { kind: native.decision_kind, body: native.decision_body, instrumentType: native.instrument_type,
      instrumentIdentifier: native.instrument_identifier, vote: native.vote, decidedOn: native.decided_on, effectiveOn: native.effective_on },
  };
  const version = database.rows.land_use_plan_versions;
  return {
    plan: database.rows.land_use_plans,
    version,
    report: { id: otherId, workspace_id: otherId, land_use_plan_id: planId, project_id: null,
      report_type: "land_use_plan_packet", status: "generated" },
    decisions: [{ id: otherId, workspace_id: otherId, plan_id: planId, version_id: versionId,
      ...native, adoption_manifest: manifest, adoption_manifest_hash: "a".repeat(64), review_release_id: otherId,
      manifest_hash_verified: true }, ...database.extraDecisions] as Array<Record<string, unknown>>,
    artifacts: [{ id: otherId, report_id: otherId, artifact_kind: "html", metadata_json: {
      landUsePlanId: planId, versionId, contentHash: version.content_hash, frozenSnapshot: version.frozen_snapshot,
      adoptionManifest: structuredClone(manifest), adoptionManifestHash: "a".repeat(64), reviewReleaseId: otherId,
    } }],
  };
}

function retainHash() {
  const hash = hashFrozenRecord(frozen);
  database.rows.land_use_plan_versions.content_hash = hash;
  database.rows.land_use_plan_review_releases.version_content_hash = hash;
  database.rows.land_use_plan_decisions.version_content_hash = hash;
}

beforeEach(() => {
  database.queries.length = 0; database.errors.clear(); database.rpcCalls.length = 0;
  database.extraDecisions = []; database.publicationOverride = undefined;
  frozen = {
    plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community",
      title: "SYNTHETIC reviewed title", authorityLabel: "SYNTHETIC reviewed authority", geographyLabel: "SYNTHETIC reviewed area" },
    version: { id: versionId, versionNumber: 1, versionKind: "original", basedOnVersionId: null, applicableRequirementKeys: ["locally_defined"] },
    nodes: [{ title: "Original policy", body: "Retain these words." }], relationships: [], designations: [], implementationActions: [],
  };
  database.rows = {
    land_use_plans: { id: planId, workspace_id: otherId, current_adopted_version_id: versionId,
      title: "Later draft title", authority_label: "Later authority", geography_label: "Later area",
      descriptor_id: "us-ca-general-plan", plan_kind_key: "comprehensive" },
    land_use_plan_versions: { id: versionId, workspace_id: otherId, plan_id: planId, version_number: 1, state: "adopted",
      frozen_snapshot: frozen, frozen_at: "2026-10-07T00:00:00Z", published_report_id: otherId },
    land_use_plan_review_releases: { id: otherId, plan_id: planId, version_id: versionId, round_number: 1,
      review_open_on: "2026-10-01", review_close_on: "2026-10-31", review_method: "external_process", status: "closed", outcome_hash: null },
    land_use_plan_decisions: { decision_kind: "adoption", decision_body: "Synthetic body", instrument_type: "Synthetic instrument",
      instrument_identifier: "TEST", vote: null, decided_on: "2026-10-07", effective_on: null },
  };
  retainHash();
});

describe.each(["adopted", "review"] as const)("%s public frozen identity", kind => {
  const load = () => kind === "adopted" ? loadPublishedLandUsePlanPacket(planId) : loadPublicLandUsePlanReviewPacket(shareToken);

  it("uses the selected kind for an explicitly unretained legacy reference", async () => {
    frozen.plan.descriptorId = "us-ca-general-plan"; frozen.plan.planKindKey = "area"; retainHash();
    const result = await load(); expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    expect(result.packet.descriptor?.terminology.plan).toBe("specific plan");
    expect(result.packet.descriptorCustody).toBe("not_retained");
    expect(result.packet.content).not.toHaveProperty("descriptorSnapshot");
    frozen.plan.planKindKey = "unsupported-kind"; retainHash();
    expect(await load()).toMatchObject({ ok: true, packet: { descriptor: null, descriptorCustody: "not_retained", content: frozen } });
  });

  it("uses the reviewed identity and descriptor after later draft edits", async () => {
    const result = await load();
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    expect(result.packet.plan).toEqual({ id: planId, title: frozen.plan.title, authorityLabel: frozen.plan.authorityLabel,
      geographyLabel: frozen.plan.geographyLabel, planKindKey: "community" });
    expect(result.packet.descriptor?.terminology).toEqual(getJurisdictionPlanDescriptor("local-unconfigured")?.terminology);
    expect(result.packet.content).toEqual(frozen);
    expect(result.packet.descriptorCustody).toBe("not_retained");
    if (kind === "adopted") {
      expect(database.rpcCalls).toEqual([["land_use_plan_publication_source_v1", { p_plan_id: planId }]]);
      expect(database.queries).toEqual([]);
    } else {
      const query = database.queries.find(q => q.table === "land_use_plan_versions")!;
      expect(query.projection.split(",").map(s => s.trim())).toEqual(expect.arrayContaining(["id", "plan_id", "version_number", "content_hash", "frozen_snapshot"]));
      expect(query.filters).toContainEqual(["eq", "plan_id", planId]);
      expect(database.queries.find(q => q.table === "land_use_plan_review_releases")?.filters).toContainEqual(["neq", "status", "withdrawn"]);
    }
  });

  it("accepts equivalent object key order without changing reviewed values", async () => {
    database.rows.land_use_plan_versions.frozen_snapshot = Object.fromEntries(Object.entries(frozen).reverse());
    expect((await load()).ok).toBe(true);
  });

  it("returns frozen context after the current plan context changes", async () => {
    frozen.planContext = syntheticPlanContext(); retainHash();
    database.rows.land_use_plans.plan_context = { ...syntheticPlanContext(), savedAt: "2026-10-08T00:00:00Z" };
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.packet.content.planContext).toEqual(frozen.planContext);
    if (kind === "review") expect(database.queries.find(q => q.table === "land_use_plans")?.projection).not.toContain("plan_context");
    else expect(database.queries).toEqual([]);
  });

  it.each(["malformed", "normalized"])("refuses self-hashed %s frozen context", async fault => {
    const context = syntheticPlanContext();
    if (fault === "malformed") context.savedBy = "unverified";
    else context.place.label = "  Trimmed label  ";
    frozen.planContext = context; retainHash();
    expect(await load()).toEqual({ ok: false, reason: "incomplete" });
  });

  it("keeps explicit null context as an unretained historical value", async () => {
    frozen.planContext = null; retainHash();
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.packet.content.planContext).toBeNull();
  });

  it("uses saved descriptor wording and dates instead of the installed edition", async () => {
    const saved = structuredClone(getJurisdictionPlanDescriptor(frozen.plan.descriptorId)!);
    saved.terminology.plan = "SYNTHETIC saved terminology";
    saved.disclosure = "SYNTHETIC original scope disclosure";
    saved.verifiedAt = "2026-01-01";
    frozen.descriptorSnapshot = saved; retainHash();
    const result = await load();
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    expect(result.packet.descriptorCustody).toBe("frozen");
    expect(result.packet.descriptor).toMatchObject({ terminology: saved.terminology, disclosure: saved.disclosure, verifiedAt: saved.verifiedAt });
  });

  it("keeps a valid saved descriptor after it is removed from the installed registry", async () => {
    frozen.descriptorSnapshot = { ...structuredClone(getJurisdictionPlanDescriptor("local-unconfigured")!), id: "retired-edition" };
    frozen.plan.descriptorId = "retired-edition"; retainHash();
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.packet.descriptor).not.toBeNull(); expect(result.packet.descriptorCustody).toBe("frozen"); }
  });

  it.each(["null", "wrong-id", "wrong-kind", "missing-source-date"])("refuses a self-hashed %s descriptor instead of substituting live rules", async fault => {
    const saved = structuredClone(getJurisdictionPlanDescriptor("local-unconfigured")!) as Record<string, unknown>;
    if (fault === "wrong-id") saved.id = "different";
    if (fault === "wrong-kind") saved.planKinds = [{ key: "other", label: "Other kind" }];
    if (fault === "missing-source-date") delete saved.verifiedAt;
    const snapshot = { ...frozen, descriptorSnapshot: fault === "null" ? null : saved };
    const hash = hashFrozenRecord(snapshot);
    database.rows.land_use_plan_versions.frozen_snapshot = snapshot;
    database.rows.land_use_plan_versions.content_hash = hash;
    database.rows.land_use_plan_review_releases.version_content_hash = hash;
    database.rows.land_use_plan_decisions.version_content_hash = hash;
    expect(await load()).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses changed frozen content even when stored hash references agree", async () => {
    frozen.nodes = [{ title: "Changed policy", body: "Different text" }];
    expect(await load()).toEqual({ ok: false, reason: "incomplete" });
  });

  it.each(["plan", "version", "number"] as const)("refuses a self-hashed snapshot for another %s", async field => {
    if (field === "plan") frozen.plan.id = otherId;
    else if (field === "version") frozen.version.id = otherId;
    else frozen.version.versionNumber = 2;
    retainHash();
    expect(await load()).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses a version row belonging to another plan", async () => {
    database.rows.land_use_plan_versions.plan_id = otherId;
    expect(await load()).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses absent frozen authority instead of using a later authority", async () => {
    const { authorityLabel: omitted, ...plan } = frozen.plan;
    expect(omitted).toBeTruthy();
    const broken = { ...frozen, plan };
    const hash = hashFrozenRecord(broken);
    database.rows.land_use_plan_versions.frozen_snapshot = broken;
    database.rows.land_use_plan_versions.content_hash = hash;
    database.rows.land_use_plan_review_releases.version_content_hash = hash;
    database.rows.land_use_plan_decisions.version_content_hash = hash;
    expect(await load()).toEqual({ ok: false, reason: "incomplete" });
  });

  it("retains an unknown descriptor as unavailable without substituting the live descriptor", async () => {
    frozen.plan.descriptorId = "not-installed"; retainHash();
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.packet.descriptor).toBeNull();
  });

  it("distinguishes a read failure from an unavailable record", async () => {
    database.errors.add("land_use_plan_versions");
    expect(await load()).toEqual({ ok: false, reason: "read_failure" });
  });
});

describe("current publication matches retained decision identity", () => {
  it.each(["newer repeal", "same-date amendment", "same-date adoption"])("refuses %s instead of choosing an ordered winner", async label => {
    database.extraDecisions = [{ ...publicationSource().decisions[0], id: versionId,
      decision_kind: label === "newer repeal" ? "repeal" : label.endsWith("amendment") ? "amendment" : "adoption",
      decided_on: label === "newer repeal" ? "2026-10-08" : "2026-10-07" }];
    expect(await loadPublishedLandUsePlanPacket(planId)).toEqual({ ok: false, reason: "incomplete" });
  });
  it("preserves exact native whitespace and additional manifest evidence", async () => {
    database.rows.land_use_plan_decisions.decision_body = "  Retained agency words  ";
    expect(await loadPublishedLandUsePlanPacket(planId)).toMatchObject({ ok: true,
      packet: { decision: { decision_body: "  Retained agency words  " } } });
  });
  it("returns the same packet on exact replay without writing or rebinding it", async () => {
    const first = await loadPublishedLandUsePlanPacket(planId);
    expect(first.ok).toBe(true);
    expect(await loadPublishedLandUsePlanPacket(planId)).toEqual(first);
    expect(database.queries).toEqual([]);
  });
  it.each(["foreign plan", "foreign version", "foreign workspace", "repeal", "changed decision", "wrong manifest hash",
    "unverified manifest hash", "wrong retained snapshot", "second artifact", "wrong artifact kind", "implementation artifact", "missing decision"])("refuses %s", async fault => {
    const source = publicationSource();
    const native = source.decisions[0];
    if (fault === "foreign plan") native.plan_id = otherId;
    if (fault === "foreign version") native.version_id = otherId;
    if (fault === "foreign workspace") native.workspace_id = planId;
    if (fault === "repeal") native.decision_kind = "repeal";
    if (fault === "changed decision") native.decision_body = "Changed native wording";
    if (fault === "wrong manifest hash") native.adoption_manifest_hash = "b".repeat(64);
    if (fault === "unverified manifest hash") native.manifest_hash_verified = false;
    if (fault === "wrong retained snapshot") source.artifacts[0].metadata_json.frozenSnapshot = {};
    if (fault === "second artifact") source.artifacts.push(structuredClone(source.artifacts[0]));
    if (fault === "wrong artifact kind") source.artifacts[0].artifact_kind = "pdf";
    if (fault === "implementation artifact") Object.assign(source.artifacts[0].metadata_json, { kind: "land_use_plan_implementation_report" });
    if (fault === "missing decision") source.decisions = [];
    database.publicationOverride = source;
    expect(await loadPublishedLandUsePlanPacket(planId)).toEqual({ ok: false, reason: "incomplete" });
  });
  it("keeps a missing published pointer distinct from a read failure", async () => {
    database.publicationOverride = null;
    expect(await loadPublishedLandUsePlanPacket(planId)).toEqual({ ok: false, reason: "not_found" });
  });
});
