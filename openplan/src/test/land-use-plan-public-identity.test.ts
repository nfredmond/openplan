import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashFrozenRecord, type FrozenPlanContent } from "@/lib/land-use-plans/versioning";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const database = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  errors: new Set<string>(),
  queries: [] as Array<{ table: string; projection: string; filters: unknown[][] }>,
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({
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

function retainHash() {
  const hash = hashFrozenRecord(frozen);
  database.rows.land_use_plan_versions.content_hash = hash;
  database.rows.land_use_plan_review_releases.version_content_hash = hash;
  database.rows.land_use_plan_decisions.version_content_hash = hash;
}

beforeEach(() => {
  database.queries.length = 0; database.errors.clear();
  frozen = {
    plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community",
      title: "SYNTHETIC reviewed title", authorityLabel: "SYNTHETIC reviewed authority", geographyLabel: "SYNTHETIC reviewed area" },
    version: { id: versionId, versionNumber: 1, versionKind: "original", basedOnVersionId: null, applicableRequirementKeys: ["locally_defined"] },
    nodes: [{ title: "Original policy", body: "Retain these words." }], relationships: [], designations: [], implementationActions: [],
  };
  database.rows = {
    land_use_plans: { id: planId, current_adopted_version_id: versionId,
      title: "Later draft title", authority_label: "Later authority", geography_label: "Later area",
      descriptor_id: "us-ca-general-plan", plan_kind_key: "comprehensive" },
    land_use_plan_versions: { id: versionId, plan_id: planId, version_number: 1, state: "adopted",
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

  it("uses the reviewed identity and descriptor after later draft edits", async () => {
    const result = await load();
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    expect(result.packet.plan).toEqual({ id: planId, title: frozen.plan.title, authorityLabel: frozen.plan.authorityLabel,
      geographyLabel: frozen.plan.geographyLabel, planKindKey: "community" });
    expect(result.packet.descriptor?.terminology).toEqual(getJurisdictionPlanDescriptor("local-unconfigured")?.terminology);
    expect(result.packet.content).toEqual(frozen);
    expect(result.packet.descriptorCustody).toBe("not_retained");
    const query = database.queries.find(q => q.table === "land_use_plan_versions")!;
    expect(query.projection.split(",").map(s => s.trim())).toEqual(expect.arrayContaining(["id", "plan_id", "version_number", "content_hash", "frozen_snapshot"]));
    expect(query.filters).toContainEqual(["eq", "plan_id", planId]);
    if (kind === "adopted") {
      expect(query.filters).toContainEqual(["eq", "state", "adopted"]);
      expect(query.filters).toContainEqual(["not", "published_report_id", "is", null]);
    } else {
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
    expect(database.queries.find(q => q.table === "land_use_plans")?.projection).not.toContain("plan_context");
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
