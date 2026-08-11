import { describe, expect, it } from "vitest";

import { KB_STORED_DOCUMENT_NOTICE } from "@/lib/knowledge-base/documents";
import {
  DOCUMENT_LIBRARY_DEFAULT_LIMIT_PER_SOURCE,
  DOCUMENT_LIBRARY_MAX_LIMIT_PER_SOURCE,
  loadDocumentLibrary,
} from "@/lib/document-library/query";
import { DOCUMENT_LIBRARY_SOURCES } from "@/lib/document-library/sources";
import {
  DOCUMENT_LIBRARY_SOURCE_IDS,
  describeDocumentLibraryOrdering,
} from "@/lib/document-library/types";

/**
 * The Document Library reader, tested against a fake that MODELS POSTGREST'S
 * JOIN SEMANTICS rather than replaying fixtures.
 *
 * Why the fake is this elaborate: two of the seven sources
 * (`report_artifacts`, `model_run_artifacts`) carry no workspace_id of their
 * own — the ONLY thing scoping their listing to the viewed workspace is the
 * `!inner` embed plus the `.eq("<parent>.workspace_id", …)` filter in the
 * descriptor's select string. A fixture-replaying fake would return whatever
 * it was seeded with and the test would pass with the join deleted. This fake
 * implements the real semantics difference instead:
 *
 *   - `parent!inner(...)` + mismatched embed filter → the ROW IS DROPPED;
 *   - plain `parent(...)`  + mismatched embed filter → the row is KEPT and the
 *     embed is nulled (what PostgREST actually does — and exactly the
 *     cross-tenant listing leak the `!inner` exists to prevent).
 *
 * So the cross-workspace decoys seeded below are load-bearing: delete `!inner`
 * from a descriptor's select and the decoy surfaces in the result, and the
 * assertions here fail. (Mutation-verified; see the lane report.)
 *
 * The fake also projects ONLY the selected columns, so a column missing from a
 * descriptor's `select` string surfaces as a broken title/href here rather
 * than as `undefined` in production — untyped Supabase clients never check
 * projections at build time.
 */

// ── The fake ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

/** FK graph the embeds resolve through — child table → embed name → relation. */
const RELATIONS: Record<string, Record<string, { fk: string; parent: string }>> = {
  report_artifacts: { reports: { fk: "report_id", parent: "reports" } },
  funding_opportunity_application_exports: {
    funding_opportunities: { fk: "opportunity_id", parent: "funding_opportunities" },
  },
  aerial_imagery: { aerial_missions: { fk: "mission_id", parent: "aerial_missions" } },
  aerial_artifact_custody: {
    aerial_missions: { fk: "mission_id", parent: "aerial_missions" },
    aerial_processing_jobs: { fk: "processing_job_id", parent: "aerial_processing_jobs" },
  },
  model_runs: { models: { fk: "model_id", parent: "models" } },
  model_run_artifacts: { model_runs: { fk: "run_id", parent: "model_runs" } },
};

type SelectNode =
  | { kind: "column"; name: string }
  | { kind: "embed"; name: string; inner: boolean; children: SelectNode[] };

function splitTopLevel(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseSelect(select: string): SelectNode[] {
  return splitTopLevel(select).map((rawPart) => {
    const part = rawPart.trim();
    const parenIndex = part.indexOf("(");
    if (parenIndex === -1) return { kind: "column", name: part };
    const head = part.slice(0, parenIndex);
    const inner = head.endsWith("!inner");
    return {
      kind: "embed",
      name: inner ? head.slice(0, -"!inner".length) : head,
      inner,
      children: parseSelect(part.slice(parenIndex + 1, part.lastIndexOf(")"))),
    };
  });
}

/** Whether every embed hop along a dotted filter path is declared `!inner` in the select. */
function pathIsAllInner(nodes: SelectNode[], path: string[]): boolean {
  let current = nodes;
  for (const hop of path.slice(0, -1)) {
    const node = current.find(
      (candidate) => candidate.kind === "embed" && candidate.name === hop
    );
    if (!node || node.kind !== "embed" || !node.inner) return false;
    current = node.children;
  }
  return true;
}

const DROP = Symbol("drop");

function lookupParent(db: Db, table: string, embedName: string, row: Row): Row | null {
  const relation = RELATIONS[table]?.[embedName];
  if (!relation) throw new Error(`fake has no relation ${table} -> ${embedName}`);
  return (db[relation.parent] ?? []).find((parent) => parent.id === row[relation.fk]) ?? null;
}

function projectRow(
  db: Db,
  table: string,
  row: Row,
  nodes: SelectNode[],
  nulledEmbeds: ReadonlySet<string>
): Row | typeof DROP {
  const out: Row = {};
  for (const node of nodes) {
    if (node.kind === "column") {
      out[node.name] = row[node.name];
      continue;
    }
    if (nulledEmbeds.has(node.name)) {
      out[node.name] = null;
      continue;
    }
    const parent = lookupParent(db, table, node.name, row);
    if (!parent) {
      if (node.inner) return DROP;
      out[node.name] = null;
      continue;
    }
    const relation = RELATIONS[table][node.name];
    const sub = projectRow(db, relation.parent, parent, node.children, new Set());
    if (sub === DROP) {
      if (node.inner) return DROP;
      out[node.name] = null;
      continue;
    }
    out[node.name] = sub;
  }
  return out;
}

function resolvePathValue(db: Db, table: string, row: Row, path: string[]): unknown {
  let currentRow: Row | null = row;
  let currentTable = table;
  for (const hop of path.slice(0, -1)) {
    if (!currentRow) return undefined;
    const parent = lookupParent(db, currentTable, hop, currentRow);
    currentTable = RELATIONS[currentTable][hop].parent;
    currentRow = parent;
  }
  return currentRow ? currentRow[path[path.length - 1]] : undefined;
}

function runQuery(
  db: Db,
  table: string,
  select: string,
  filters: Array<{ path: string[]; value: unknown }>,
  order: { column: string; ascending: boolean } | null,
  limitCount: number | null
): Row[] {
  const nodes = parseSelect(select);
  const kept: Array<{ row: Row; nulled: Set<string> }> = [];

  for (const row of db[table] ?? []) {
    let dropped = false;
    const nulled = new Set<string>();
    for (const filter of filters) {
      if (filter.path.length === 1) {
        if (row[filter.path[0]] !== filter.value) {
          dropped = true;
          break;
        }
        continue;
      }
      const value = resolvePathValue(db, table, row, filter.path);
      if (value === filter.value) continue;
      // THE SEMANTICS UNDER TEST: an embed filter only removes the parent row
      // when the whole path is `!inner`; otherwise PostgREST nulls the embed
      // and keeps the row — the leak shape.
      if (pathIsAllInner(nodes, filter.path)) {
        dropped = true;
        break;
      }
      nulled.add(filter.path[0]);
    }
    if (dropped) continue;
    const projected = projectRow(db, table, row, nodes, nulled);
    if (projected === DROP) continue;
    kept.push({ row: projected, nulled });
  }

  let rows = kept.map((entry) => entry.row);
  if (order) {
    const { column, ascending } = order;
    rows = [...rows].sort((a, b) => {
      const compared = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
      return ascending ? compared : -compared;
    });
  }
  if (limitCount !== null) rows = rows.slice(0, limitCount);
  return rows;
}

type FakeResult = { data: unknown; error: { message: string } | null };

function createFakeSupabase(db: Db, failures: Record<string, string> = {}) {
  const selects: Record<string, string> = {};
  const client = {
    from(table: string) {
      return {
        select(select: string) {
          selects[table] = select;
          const filters: Array<{ path: string[]; value: unknown }> = [];
          let order: { column: string; ascending: boolean } | null = null;
          let limitCount: number | null = null;
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ path: column.split("."), value });
              return builder;
            },
            order(column: string, options?: { ascending?: boolean }) {
              order = { column, ascending: options?.ascending === true };
              return builder;
            },
            limit(count: number) {
              limitCount = count;
              return builder;
            },
            then<T>(
              resolve: (result: FakeResult) => T,
              reject?: (reason: unknown) => T
            ): Promise<T> {
              const failure = failures[table];
              const result: FakeResult = failure
                ? { data: null, error: { message: failure } }
                : {
                    data: runQuery(db, table, select, filters, order, limitCount),
                    error: null,
                  };
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, selects };
}

// ── Fixtures: workspace A is being viewed; every source gets a workspace-B decoy ──

const WS_A = "ws-aaaa-0000";
const WS_B = "ws-bbbb-0000";
const PROJ_1 = "proj-1111";
const PROJ_2 = "proj-2222";
const PROJ_B = "proj-bbbb";

function buildDb(): Db {
  return {
    kb_documents: [
      {
        id: "kb-ready",
        workspace_id: WS_A,
        project_id: PROJ_1,
        title: "Adopted RTP 2045",
        doc_kind: "rtp",
        source_kind: "uploaded_pdf",
        byte_size: 4_200_000,
        storage_ref: "storage://kb-documents/ws-aaaa-0000/kb-ready/rtp.pdf",
        status: "ready",
        extraction_error: null,
        created_at: "2026-08-09T10:00:00Z",
      },
      {
        id: "kb-stored",
        workspace_id: WS_A,
        project_id: null,
        title: "Corridor exhibit (scanned)",
        doc_kind: "exhibit",
        source_kind: "uploaded_image",
        byte_size: 18_000_000,
        storage_ref: "storage://kb-documents/ws-aaaa-0000/kb-stored/exhibit.tif",
        status: "stored",
        extraction_error: null,
        created_at: "2026-08-08T10:00:00Z",
      },
      {
        id: "kb-paste",
        workspace_id: WS_A,
        project_id: null,
        title: "Board motion text",
        doc_kind: "other",
        source_kind: "pasted_text",
        byte_size: null,
        storage_ref: null,
        status: "ready",
        extraction_error: null,
        created_at: "2026-08-07T10:00:00Z",
      },
      {
        id: "kb-failed",
        workspace_id: WS_A,
        project_id: null,
        title: "Scan with no text layer",
        doc_kind: "prior_study",
        source_kind: "uploaded_pdf",
        byte_size: 900_000,
        storage_ref: "storage://kb-documents/ws-aaaa-0000/kb-failed/scan.pdf",
        status: "failed",
        extraction_error: "No extractable text found in this PDF.",
        created_at: "2026-08-06T10:00:00Z",
      },
      {
        id: "kb-decoy",
        workspace_id: WS_B,
        project_id: PROJ_B,
        title: "Other workspace document",
        doc_kind: "other",
        source_kind: "uploaded_pdf",
        byte_size: 1,
        storage_ref: "storage://kb-documents/ws-bbbb-0000/kb-decoy/x.pdf",
        status: "ready",
        extraction_error: null,
        created_at: "2026-08-09T11:00:00Z",
      },
    ],
    reports: [
      { id: "rep-a", workspace_id: WS_A, project_id: PROJ_1, title: "Corridor Study Status" },
      { id: "rep-b", workspace_id: WS_B, project_id: PROJ_B, title: "Other workspace report" },
    ],
    // report_artifacts has NO workspace_id — the decoy's tenancy exists only on
    // its parent report, which is the entire point of the !inner join.
    report_artifacts: [
      {
        id: "art-a1",
        report_id: "rep-a",
        artifact_kind: "pdf",
        storage_path: "ws-aaaa-0000/rep-a/art-a1.pdf",
        generated_at: "2026-08-05T10:00:00Z",
      },
      {
        id: "art-a2-unstored",
        report_id: "rep-a",
        artifact_kind: "html",
        storage_path: null,
        generated_at: "2026-08-04T10:00:00Z",
      },
      {
        id: "art-decoy",
        report_id: "rep-b",
        artifact_kind: "pdf",
        storage_path: "ws-bbbb-0000/rep-b/art-decoy.pdf",
        generated_at: "2026-08-05T11:00:00Z",
      },
    ],
    funding_opportunities: [
      { id: "opp-a", workspace_id: WS_A, project_id: PROJ_1, title: "ATP Cycle 7" },
      { id: "opp-b", workspace_id: WS_B, project_id: PROJ_B, title: "Other workspace grant" },
    ],
    funding_opportunity_application_exports: [
      {
        id: "exp-a",
        workspace_id: WS_A,
        opportunity_id: "opp-a",
        page_count: 12,
        generated_at: "2026-08-03T10:00:00Z",
      },
      {
        id: "exp-decoy",
        workspace_id: WS_B,
        opportunity_id: "opp-b",
        page_count: 3,
        generated_at: "2026-08-03T11:00:00Z",
      },
    ],
    client_invoices: [
      {
        id: "inv-a",
        workspace_id: WS_A,
        project_id: PROJ_2,
        invoice_number: "2026-014",
        status: "sent",
        invoice_date: "2026-08-01",
        created_at: "2026-08-02T10:00:00Z",
      },
      {
        id: "inv-decoy",
        workspace_id: WS_B,
        project_id: PROJ_B,
        invoice_number: "9999",
        status: "draft",
        invoice_date: "2026-08-01",
        created_at: "2026-08-02T11:00:00Z",
      },
    ],
    aerial_missions: [
      { id: "mis-a", workspace_id: WS_A, project_id: PROJ_1, title: "River Rd survey" },
      { id: "mis-b", workspace_id: WS_B, project_id: PROJ_B, title: "Other workspace mission" },
    ],
    aerial_imagery: [
      {
        id: "img-a",
        workspace_id: WS_A,
        mission_id: "mis-a",
        original_filename: "DJI_0042.JPG",
        byte_size: 8_400_000,
        captured_at: "2026-07-30T18:00:00Z",
        created_at: "2026-08-01T10:00:00Z",
      },
      {
        id: "img-decoy",
        workspace_id: WS_B,
        mission_id: "mis-b",
        original_filename: "DJI_0001.JPG",
        byte_size: 1,
        captured_at: null,
        created_at: "2026-08-01T11:00:00Z",
      },
    ],
    aerial_processing_jobs: [
      { id: "job-a", workspace_id: WS_A, project_id: PROJ_1, mission_id: "mis-a" },
      { id: "job-b", workspace_id: WS_B, project_id: PROJ_B, mission_id: "mis-b" },
    ],
    aerial_artifact_custody: [
      {
        id: "cus-held",
        workspace_id: WS_A,
        mission_id: "mis-a",
        processing_job_id: "job-a",
        kind: "orthomosaic",
        state: "held",
        byte_size: 512_000_000,
        failure_code: null,
        failure_detail: null,
        created_at: "2026-07-31T10:00:00Z",
      },
      {
        id: "cus-failed",
        workspace_id: WS_A,
        mission_id: "mis-a",
        processing_job_id: "job-a",
        kind: "dsm",
        state: "failed",
        byte_size: null,
        failure_code: "http_error",
        failure_detail: "The vendor's download link answered HTTP 500.",
        created_at: "2026-07-31T09:00:00Z",
      },
      {
        id: "cus-pending",
        workspace_id: WS_A,
        mission_id: "mis-a",
        processing_job_id: "job-a",
        kind: "point_cloud",
        state: "pending",
        byte_size: null,
        failure_code: null,
        failure_detail: null,
        created_at: "2026-07-31T08:00:00Z",
      },
      {
        id: "cus-refused",
        workspace_id: WS_A,
        mission_id: "mis-a",
        processing_job_id: "job-a",
        kind: "mesh",
        state: "refused",
        byte_size: null,
        failure_code: "too_large",
        failure_detail: "Larger than this deployment's custody ceiling.",
        created_at: "2026-07-31T07:00:00Z",
      },
      {
        id: "cus-decoy",
        workspace_id: WS_B,
        mission_id: "mis-b",
        processing_job_id: "job-b",
        kind: "orthomosaic",
        state: "held",
        byte_size: 1,
        failure_code: null,
        failure_detail: null,
        created_at: "2026-07-31T11:00:00Z",
      },
    ],
    models: [
      { id: "mod-a", workspace_id: WS_A, project_id: PROJ_1, title: "Countywide TDM" },
      { id: "mod-b", workspace_id: WS_B, project_id: PROJ_B, title: "Other workspace model" },
    ],
    model_runs: [
      { id: "run-a", workspace_id: WS_A, model_id: "mod-a", run_title: "AM peak assignment" },
      { id: "run-b", workspace_id: WS_B, model_id: "mod-b", run_title: "Other workspace run" },
    ],
    // model_run_artifacts also has NO workspace_id; tenancy lives on model_runs.
    model_run_artifacts: [
      {
        id: "mra-a",
        run_id: "run-a",
        artifact_type: "skim_matrix",
        file_size_bytes: 2_300_000,
        // file_url deliberately present in the DB row but NEVER selected — the
        // projection-faithful fake proves it stays out of the result.
        file_url: "storage://run-artifacts/run-a/skims.omx",
        created_at: "2026-07-29T10:00:00Z",
      },
      {
        id: "mra-decoy",
        run_id: "run-b",
        artifact_type: "skim_matrix",
        file_size_bytes: 1,
        file_url: "storage://run-artifacts/run-b/skims.omx",
        created_at: "2026-07-29T11:00:00Z",
      },
    ],
  };
}

function entryIds(entries: Array<{ id: string }>): string[] {
  return entries.map((entry) => entry.id);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("loadDocumentLibrary", () => {
  it("lists every phase-1 source for the workspace, and NO cross-workspace row survives — including the two tables whose only tenancy is the !inner parent join", async () => {
    const { client } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A });

    const ids = entryIds(result.entries);
    // The two no-workspace_id decoys: with `!inner` deleted from the select,
    // the fake keeps these rows with a nulled parent (PostgREST's real
    // behavior) and these assertions fail. That is the leak being guarded.
    expect(ids).not.toContain("art-decoy");
    expect(ids).not.toContain("mra-decoy");
    expect(ids).not.toContain("kb-decoy");
    expect(ids).not.toContain("exp-decoy");
    expect(ids).not.toContain("inv-decoy");
    expect(ids).not.toContain("img-decoy");
    expect(ids).not.toContain("cus-decoy");

    expect(ids).toEqual([
      // knowledge base, most recent first
      "kb-ready",
      "kb-stored",
      "kb-paste",
      "kb-failed",
      // report artifacts
      "art-a1",
      "art-a2-unstored",
      // grant exports
      "exp-a",
      // invoices
      "inv-a",
      // aerial imagery
      "img-a",
      // custody, all four states listed
      "cus-held",
      "cus-failed",
      "cus-pending",
      "cus-refused",
      // model-run artifacts
      "mra-a",
    ]);

    expect(result.reads.any).toBe(false);
    expect(result.perSource.knowledge_base).toEqual({ count: 4, pending: false, failed: false });
    expect(result.perSource.report_artifacts).toEqual({ count: 2, pending: false, failed: false });
    expect(result.perSource.model_run_artifacts).toEqual({
      count: 1,
      pending: false,
      failed: false,
    });
  });

  it("builds every download link as an app ROUTE — never a storage URL, and never from a storage path column", async () => {
    const { client } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A });

    for (const entry of result.entries) {
      if (entry.downloadHref !== null) {
        expect(entry.downloadHref.startsWith("/api/")).toBe(true);
        expect(entry.downloadHref).not.toContain("storage://");
        expect(entry.downloadHref).not.toContain("/storage/v1/");
      }
    }

    const byId = new Map(result.entries.map((entry) => [entry.id, entry]));
    expect(byId.get("kb-ready")?.downloadHref).toBe(
      "/api/knowledge-base/documents/kb-ready/download"
    );
    expect(byId.get("art-a1")?.downloadHref).toBe("/api/reports/rep-a/artifacts/art-a1/download");
    expect(byId.get("exp-a")?.downloadHref).toBe(
      "/api/funding-opportunities/opp-a/application/export/exp-a/download"
    );
    expect(byId.get("inv-a")?.downloadHref).toBe("/api/invoicing/client-invoices/inv-a/pdf");
    expect(byId.get("img-a")?.downloadHref).toBe(
      "/api/aerial/missions/mis-a/imagery/img-a/download"
    );
    expect(byId.get("cus-held")?.downloadHref).toBe(
      "/api/aerial/processing-jobs/job-a/artifacts/cus-held/download"
    );
    expect(byId.get("mra-a")?.downloadHref).toBe(
      "/api/models/mod-a/runs/run-a/artifacts/mra-a/download"
    );

    // The untrusted file_url exists on the DB row; it must not surface anywhere.
    const modelEntry = byId.get("mra-a");
    expect(JSON.stringify(modelEntry)).not.toContain("run-artifacts");
  });

  it("threads the project scope through every source, including the nested model_runs.models path", async () => {
    const { client } = createFakeSupabase(buildDb());

    const proj1 = await loadDocumentLibrary(client, { workspaceId: WS_A, projectId: PROJ_1 });
    expect(entryIds(proj1.entries)).toEqual([
      "kb-ready",
      "art-a1",
      "art-a2-unstored",
      "exp-a",
      "img-a",
      "cus-held",
      "cus-failed",
      "cus-pending",
      "cus-refused",
      "mra-a",
    ]);

    // The binding varies: a different project selects a DIFFERENT non-empty
    // set, so a hardcoded filter value cannot pass both.
    const proj2 = await loadDocumentLibrary(client, { workspaceId: WS_A, projectId: PROJ_2 });
    expect(entryIds(proj2.entries)).toEqual(["inv-a"]);
  });

  it("keeps one source's failure out of the others: the failed lane reports itself, everything else still lists", async () => {
    const { client } = createFakeSupabase(buildDb(), {
      report_artifacts: "permission denied for table report_artifacts",
    });
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A });

    expect(result.perSource.report_artifacts).toEqual({ count: 0, pending: false, failed: true });
    expect(result.reads.any).toBe(true);
    expect(result.reads.describe()).toContain("report files");
    // No report entries — and no other source went missing because of it.
    expect(entryIds(result.entries)).not.toContain("art-a1");
    expect(result.perSource.knowledge_base?.count).toBe(4);
    expect(result.perSource.model_run_artifacts?.count).toBe(1);
  });

  it("classifies a pending migration as pending, not as a failure to disclose", async () => {
    const { client } = createFakeSupabase(buildDb(), {
      aerial_imagery: 'relation "public.aerial_imagery" does not exist',
    });
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A });

    expect(result.perSource.aerial_imagery).toEqual({ count: 0, pending: true, failed: false });
    expect(result.reads.any).toBe(false);
  });

  it("renders non-held custody rows with their failure vocabulary and NO link; only the held row gets bytes and a route", async () => {
    const { client } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, {
      workspaceId: WS_A,
      sources: ["aerial_artifact_custody"],
    });
    const byId = new Map(result.entries.map((entry) => [entry.id, entry]));

    const held = byId.get("cus-held");
    expect(held?.hasBytes).toBe(true);
    expect(held?.byteSize).toBe(512_000_000);
    expect(held?.badge).toEqual({ label: "Held", tone: "positive" });
    expect(held?.downloadHref).not.toBeNull();
    expect(held?.title).toBe("Orthomosaic — River Rd survey");

    const failed = byId.get("cus-failed");
    expect(failed?.hasBytes).toBe(false);
    expect(failed?.downloadHref).toBeNull();
    expect(failed?.badge).toEqual({ label: "Custody failed", tone: "critical" });
    expect(failed?.detail).toBe("The vendor's download link answered HTTP 500.");

    const pending = byId.get("cus-pending");
    expect(pending?.downloadHref).toBeNull();
    expect(pending?.badge.label).toBe("Custody pending");
    expect(pending?.detail).toBe("OpenPlan has not taken custody of this file yet.");

    const refused = byId.get("cus-refused");
    expect(refused?.downloadHref).toBeNull();
    expect(refused?.badge).toEqual({ label: "Custody refused", tone: "warning" });
    expect(refused?.detail).toBe("Larger than this deployment's custody ceiling.");
  });

  it("marks ONLY ready knowledge-base rows groundable; a stored file is findable, downloadable, and honestly not citable", async () => {
    const { client } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A });
    const byId = new Map(result.entries.map((entry) => [entry.id, entry]));

    const groundableIds = result.entries.filter((entry) => entry.groundable).map((e) => e.id);
    expect(groundableIds.sort()).toEqual(["kb-paste", "kb-ready"]);

    const stored = byId.get("kb-stored");
    expect(stored?.groundable).toBe(false);
    expect(stored?.badge).toEqual({ label: "Stored", tone: "neutral" });
    expect(stored?.detail).toBe(KB_STORED_DOCUMENT_NOTICE);
    expect(stored?.downloadHref).toBe("/api/knowledge-base/documents/kb-stored/download");

    // A paste has no stored original: citable, but honestly nothing to download.
    const paste = byId.get("kb-paste");
    expect(paste?.hasBytes).toBe(false);
    expect(paste?.downloadHref).toBeNull();

    const failed = byId.get("kb-failed");
    expect(failed?.groundable).toBe(false);
    expect(failed?.badge.label).toBe("Indexing failed");
    expect(failed?.detail).toBe("No extractable text found in this PDF.");

    // Invoices are rendered on request: a link, but no stored bytes claimed.
    const invoice = byId.get("inv-a");
    expect(invoice?.hasBytes).toBe(false);
    expect(invoice?.byteSize).toBeNull();
    expect(invoice?.downloadHref).toBe("/api/invoicing/client-invoices/inv-a/pdf");
  });

  it("caps each source at limitPerSource, reports the cap in the result, and clamps nonsense values", async () => {
    const { client } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A, limitPerSource: 2 });

    expect(result.limitPerSource).toBe(2);
    expect(result.perSource.knowledge_base?.count).toBe(2);
    // Most recent two by created_at — the cap takes the NEWEST, not the first seeded.
    expect(entryIds(result.entries).slice(0, 2)).toEqual(["kb-ready", "kb-stored"]);
    // Custody had 4 rows in workspace A; capped to 2.
    expect(result.perSource.aerial_artifact_custody?.count).toBe(2);

    const defaulted = await loadDocumentLibrary(client, { workspaceId: WS_A, limitPerSource: 0 });
    expect(defaulted.limitPerSource).toBe(DOCUMENT_LIBRARY_DEFAULT_LIMIT_PER_SOURCE);
    const clamped = await loadDocumentLibrary(client, { workspaceId: WS_A, limitPerSource: 500 });
    expect(clamped.limitPerSource).toBe(DOCUMENT_LIBRARY_MAX_LIMIT_PER_SOURCE);
  });

  it("reads only the requested sources; an unqueried source is ABSENT from perSource, which is different from zero", async () => {
    const { client, selects } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, {
      workspaceId: WS_A,
      sources: ["invoice_pdfs"],
    });

    expect(entryIds(result.entries)).toEqual(["inv-a"]);
    expect(result.perSource.invoice_pdfs).toEqual({ count: 1, pending: false, failed: false });
    expect(result.perSource.knowledge_base).toBeUndefined();
    expect(Object.keys(selects)).toEqual(["client_invoices"]);
  });

  it("groups the merged list by source in canonical order and labels the ordering instead of claiming a global sort", async () => {
    const { client } = createFakeSupabase(buildDb());
    const result = await loadDocumentLibrary(client, { workspaceId: WS_A });

    const sourceSequence = result.entries.map((entry) => entry.sourceId);
    const canonical = [...DOCUMENT_LIBRARY_SOURCE_IDS];
    // Once a later source starts, an earlier one never reappears.
    const firstIndex = sourceSequence.map((id) => canonical.indexOf(id));
    expect([...firstIndex].sort((a, b) => a - b)).toEqual(firstIndex);

    const label = describeDocumentLibraryOrdering(result.limitPerSource);
    expect(label).toContain(String(result.limitPerSource));
    expect(label).toContain("each source");
    expect(label.toLowerCase()).not.toContain("newest overall");
  });

  it("never selects the untrusted or member-writable path columns from the two risky sources", () => {
    const bySourceId = new Map(DOCUMENT_LIBRARY_SOURCES.map((source) => [source.id, source]));
    // model_run_artifacts.file_url is untrusted data (artifact-source.ts).
    expect(bySourceId.get("model_run_artifacts")?.select).not.toContain("file_url");
    // funding_opportunity_application_exports.storage_path is member-INSERTable.
    expect(bySourceId.get("grant_application_exports")?.select).not.toContain("storage_path");
  });
});
