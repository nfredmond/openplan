import { createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient as realClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { describe, it, expect, vi } from "vitest";
import type { PortfolioRoundTripProject } from "@/lib/projects/portfolio-export";

type Row = Record<string, unknown>;
type Portfolio = { count: number; workspace: string; name: string; rows: Row[] };
type Trace = { cursor: string | null; url: string; actualUrl: string; offset: number; limit: number; select: string; scope: string | null; order: string | null; status: number; contentRange: string | null; rows: Row[] | null; error: unknown };
const ctx = vi.hoisted(() => ({ client: null as unknown, selected: null as unknown, actor: "", inputs: [] as Array<{ workspaceId: string; workspaceName: string; projects: PortfolioRoundTripProject[]; generatedAt: Date }> }));

// These two adapters supply fixture identity and the selected workspace. No cookie or Auth provider executes.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ctx.client }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: async () => ctx.selected }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("@/lib/projects/portfolio-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects/portfolio-export")>();
  return { ...actual, buildPortfolioRoundTripWorkbook: (input: Parameters<typeof actual.buildPortfolioRoundTripWorkbook>[0]) => {
    ctx.inputs.push(input);
    return actual.buildPortfolioRoundTripWorkbook(input);
  } };
});

import { GET } from "@/app/api/projects/export/workbook/route";
import { buildPortfolioRoundTripWorkbook, PORTFOLIO_ROUND_TRIP_HEADERS, PORTFOLIO_ROUND_TRIP_CONTENT_TYPE, portfolioRoundTripFilename } from "@/lib/projects/portfolio-export";

const base = process.env.PROOF_BASE!;
const cap = Number(process.env.PROOF_CAP);
const runtime = JSON.parse(readFileSync(path.join(base, `cap-${cap}`, "client-private.json"), "utf8"));
const fixtures = JSON.parse(readFileSync(path.join(base, "fixtures-private.json"), "utf8")) as { actor: string; portfolios: Portfolio[] };
const projection = ["id", "name", "summary", "status", "plan_type", "delivery_phase", "estimated_cost_amount", "estimated_cost_currency", "estimated_cost_basis_year", "estimated_cost_source_document_id", "estimated_cost_recorded_at", "created_at", "updated_at", "place_source", "place_kind", "place_ref", "place_label", "place_country_code", "place_subdivision_code", "place_min_lon", "place_min_lat", "place_max_lon", "place_max_lat", "place_set_at"];
const observations: unknown[] = [];

function jwt(): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = enc({ alg: "HS256", typ: "JWT" }) + "." + enc({ sub: fixtures.actor, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return body + "." + createHmac("sha256", runtime.secret).update(body).digest("base64url");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

// Compare native SQL originals with PostgREST JSON without replacing the query or serializer.
function originalRows(p: Portfolio): Row[] {
  return p.rows.map((row) => Object.fromEntries(projection.map((column) => {
    let value = row[column];
    if ((column === "created_at" || column === "updated_at" || column === "place_set_at" || column === "estimated_cost_recorded_at") && typeof value === "string") value = value.replace(" ", "T");
    if (column === "estimated_cost_amount" && value !== null) value = Number(value);
    return [column, value];
  })));
}

async function invoke(p: Portfolio, failLater = false, concurrent = false) {
  ctx.inputs = [];
  const traces: Trace[] = [];
  const token = jwt();
  const client = realClient(runtime.url, "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: async (input, init) => {
      const url = new URL(String(input));
      // Direct local PostgREST has no Supabase gateway prefix.
      url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
      if (url.pathname === "/projects") {
        const requested = new URL(url);
        if (failLater && traces.length === 1) url.searchParams.set("select", "id,workbook_proof_missing_column");
        const response = await fetch(url, init);
        const body: unknown = await response.clone().json();
        traces.push({ url: requested.toString(), actualUrl: url.toString(), cursor: requested.searchParams.get("id"), offset: Number(requested.searchParams.get("offset") ?? 0), limit: Number(requested.searchParams.get("limit")),
          select: requested.searchParams.get("select") ?? "", scope: requested.searchParams.get("workspace_id"), order: requested.searchParams.get("order"),
          status: response.status, contentRange: response.headers.get("content-range"), rows: Array.isArray(body) ? body : null, error: Array.isArray(body) ? null : body });
        if (concurrent && traces.length === 1) nativeEdit("edit");
        return response;
      }
      return fetch(url, init);
    } },
  });
  // Node JWT fixture and minimal auth-context adapter, explicitly not browser login.
  client.auth.getUser = vi.fn().mockResolvedValue({ data: { user: { id: fixtures.actor } }, error: null });
  ctx.client = client;
  const membership = await client.from("workspace_members").select("workspace_id,user_id,role").eq("workspace_id", p.workspace).eq("user_id", fixtures.actor).single();
  const workspace = await client.from("workspaces").select("id,name").eq("id", p.workspace).single();
  if (p.count === 3) {
    expect(membership.data, "inaccessible membership absent").toBeNull();
    expect(workspace.data, "inaccessible workspace absent").toBeNull();
    ctx.selected = { membership: null, workspace: null };
    const direct = await client.from("projects").select("id").eq("workspace_id", p.workspace);
    expect(direct.error, "RLS empty read is not SQL error").toBeNull();
    expect(direct.data, "RLS hides inaccessible workspace rows").toEqual([]);
    const response = await GET(new NextRequest("http://synthetic.invalid/api/projects/export/workbook"));
    return { response, bytes: new Uint8Array(await response.arrayBuffer()), traces, inputs: [...ctx.inputs] };
  }
  expect(membership.error, "adapter membership must use native visible row").toBeNull();
  expect(workspace.error, "adapter workspace must use native visible row").toBeNull();
  expect(membership.data?.role, "native fixture must retain viewer role").toBe("viewer");
  ctx.selected = { membership: membership.data, workspace: workspace.data };
  const response = await GET(new NextRequest("http://synthetic.invalid/api/projects/export/workbook"));
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, traces, inputs: [...ctx.inputs] };
}

function nativeEdit(action: string) {
  execFileSync("python3", ["-B", process.env.PROOF_NATIVE!, "concurrent", action], { stdio: "pipe" });
}
function queryChecks(traces: Trace[], p: Portfolio, failLater = false, concurrent = false) {
  let received = 0;
  let cursor: string | null = null;
  const sql = originalRows(p).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  if (concurrent) {
    const changed = JSON.parse(readFileSync(path.join(base,"concurrent-edit-private.json"),"utf8"));
    const row = changed.rows.find((x: Row) => x.id === changed.id);
    sql.find(x => x.id === changed.id)!.updated_at = row.updated_at.replace(" ","T");
  }
  for (const [index, trace] of traces.entries()) {
    expect(trace.offset, "keyset must omit offset").toBe(0);
    expect(trace.cursor, "strict cursor must use last received native UUID").toBe(cursor === null ? null : "gt."+cursor);
    expect(trace.limit, "request must retain bounded sentinel limit").toBe(Math.min(1000,2001-received));
    expect(trace.select.split(",").sort(), "native exact projection").toEqual([...projection].sort());
    expect(trace.scope, "native selected workspace predicate").toBe("eq."+p.workspace);
    expect(trace.order, "native UUID ascending order").toBe("id.asc");
    if (failLater && index===1) {
      expect(trace.status, "real later SQL error status").toBe(400);
      expect((trace.error as {code:string}).code, "real later SQLSTATE").toBe("42703");
      continue;
    }
    expect(trace.status, "native successful page status").toBe(200);
    const rows=trace.rows!;
    expect(rows.length, "native cap and remaining limit").toBe(Math.min(cap,trace.limit,Math.max(0,p.count-received)));
    expect(trace.contentRange, "native keyset content range starts at zero").toBe(rows.length ? `0-${rows.length-1}/*` : "*/*");
    expect(canonical(rows), "native exact SQL values in UUID order").toEqual(canonical(sql.slice(received,received+rows.length)));
    received+=rows.length;
    if (rows.length) cursor=String(rows.at(-1)!.id);
  }
  return received;
}

function refusal(r: Awaited<ReturnType<typeof invoke>>, status: number) {
  expect(r.response.status, "route refusal must retain exact HTTP status").toBe(status);
  expect(r.response.headers.get("content-disposition"), "refusal must have no download header").toBeNull();
  expect(r.response.headers.get("content-type"), "refusal must remain JSON").toContain("application/json");
  expect(r.inputs.length, "refusal must never invoke workbook serializer").toBe(0);
}

describe("real native capped workbook", () => {
  for (const count of (cap === 2 ? [] : [0, 2000, 2001])) it(`portfolio-${count}`, async () => {
    const p = fixtures.portfolios.find((x) => x.count === count)!;
    const r = await invoke(p);
    const offset = queryChecks(r.traces, p);
    expect(offset, "live read must retain all supported rows or exact sentinel").toBe(count);
    expect(r.traces.length, "native page count must include final empty page or bounded sentinel").toBe(count === 2001 ? Math.ceil(2001 / cap) : Math.ceil(count / cap) + 1);
    if (count === 2001) {
      refusal(r, 409);
      expect(JSON.parse(Buffer.from(r.bytes).toString()).code, "over-limit must retain explicit row_limit code").toBe("row_limit");
    } else {
      expect(r.response.status, "complete workbook must retain HTTP 200").toBe(200);
      expect(r.response.headers.get("content-type"), "workbook response must retain MIME type").toBe(PORTFOLIO_ROUND_TRIP_CONTENT_TYPE);
      expect(r.response.headers.get("cache-control"), "workbook response must remain private no-store").toBe("private, no-store");
      expect(r.inputs.length, "success must serialize exactly once").toBe(1);
      const actual = r.inputs[0];
      expect(actual.workspaceId, "serializer must retain selected workspace id").toBe(p.workspace);
      expect(actual.workspaceName, "serializer must retain selected workspace name").toBe(p.name);
      expect(canonical(actual.projects), "serializer must receive every original projected row").toEqual(canonical(originalRows(p)));
      expect(r.response.headers.get("content-disposition"), "workbook must retain exact attachment filename").toBe(`attachment; filename="${portfolioRoundTripFilename(p.name, actual.generatedAt)}"`);
      const expected = await buildPortfolioRoundTripWorkbook({ ...actual, workspaceId: p.workspace, workspaceName: p.name, projects: originalRows(p) as unknown as PortfolioRoundTripProject[] });
      expect(Buffer.from(r.bytes).equals(Buffer.from(expected)), "download material must equal actual serializer from original SQL rows").toBe(true);
      const wb = XLSX.read(r.bytes, { type: "array" });
      expect(wb.SheetNames, "workbook must retain Projects and Read me sheets").toEqual(["Projects", "Read me"]);
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Projects, { header: 1, defval: "", blankrows: false });
      expect(rows[0], "header-only and populated workbook must retain exact headers").toEqual([...PORTFOLIO_ROUND_TRIP_HEADERS]);
      expect(rows.length, "workbook must contain every native project and one header").toBe(count + 1);
      for (const [i, row] of originalRows(p).entries()) {
        expect(rows[i+1][1], "worksheet must retain exact original project IDs").toBe(row.id);
        expect(rows[i+1][5], "worksheet must preserve unknown price year as blank").toBe(row.estimated_cost_basis_year === null ? "" : String(row.estimated_cost_basis_year));
        expect(wb.Sheets.Projects[XLSX.utils.encode_cell({r:i+1,c:0})].t, "operator-prefixed project name must remain text").toBe("s");
        expect(wb.Sheets.Projects[XLSX.utils.encode_cell({r:i+1,c:0})].f, "operator-prefixed project name must never become formula").toBeUndefined();
      }
      writeFileSync(path.join(process.env.PROOF_OUTPUT!, `portfolio-${count}.xlsx`), r.bytes, { mode: 0o600 });
    }
    observations.push({ case: count, status: r.response.status, headers: Object.fromEntries(r.response.headers), sha256: createHash("sha256").update(r.bytes).digest("hex"), traces: r.traces.map(t=>({...t,rows:t.rows?.map(x=>x.id)})) });
    writeFileSync(path.join(process.env.PROOF_OUTPUT!, "observations.json"), JSON.stringify(observations, null, 2));
  });

  if (cap !== 2) it("later-page-error", async () => {
    const p = fixtures.portfolios.find((x) => x.count === 2000)!;
    const r = await invoke(p, true);
    queryChecks(r.traces, p, true);
    expect(r.traces.length, "failed second page must stop before further reads").toBe(2);
    refusal(r, 500);
    expect(JSON.parse(Buffer.from(r.bytes).toString()).error, "native page failure must retain read refusal diagnostic").toBe("Failed to read the project portfolio");
    observations.push({ case:"later-page-error", status:r.response.status, traces:r.traces.map(t=>({...t,rows:t.rows?.map(x=>x.id)})),headers:Object.fromEntries(r.response.headers) });
    writeFileSync(path.join(process.env.PROOF_OUTPUT!, "observations.json"), JSON.stringify(observations,null,2));
  });
  if (cap !== 2) it("inaccessible-rls", async () => {
    const p=fixtures.portfolios.find(x=>x.count===3)!;
    const r=await invoke(p);
    refusal(r,404);
    expect(r.traces.length,"inaccessible route adds no read after deliberate direct RLS query").toBe(1);
    observations.push({case:"inaccessible-rls",status:r.response.status,directRead:"200 empty, native membership/workspace absent"});
    writeFileSync(path.join(process.env.PROOF_OUTPUT!,"observations.json"),JSON.stringify(observations,null,2));
  });
  if (cap === 2) it("concurrent-edit", async () => {
    const p=fixtures.portfolios.find(x=>x.count===4)!;
    try {
      const r=await invoke(p,false,true);
      expect(r.response.status,"concurrent route must succeed").toBe(200);
      expect(r.inputs[0].projects.length,"concurrent count remains four").toBe(4);
      // Count alone accepts the old reader. Native SQL original UUIDs are retained independently.
      const ids=r.inputs[0].projects.map(x=>x.id);
      writeFileSync(path.join(process.env.PROOF_OUTPUT!,"concurrent-before-assert.json"),JSON.stringify({count:ids.length,ids,originalIds:p.rows.map(x=>x.id),traces:r.traces},null,2));
      expect([...ids].sort(),"concurrent exact original UUIDs once").toEqual(p.rows.map(x=>String(x.id)).sort());
      queryChecks(r.traces,p,false,true);
      const changed=JSON.parse(readFileSync(path.join(base,"concurrent-edit-private.json"),"utf8"));
      const presentation=originalRows({...p,rows:changed.rows});
      expect(canonical(r.inputs[0].projects),"concurrent received values retain native SQL presentation order").toEqual(canonical(presentation));
      const wb=XLSX.read(r.bytes,{type:"array"});
      const rows=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Projects,{header:1,defval:"",blankrows:false});
      expect(rows.slice(1).map(x=>x[1]),"concurrent emitted workbook UUID order").toEqual(presentation.map(x=>x.id));
      writeFileSync(path.join(process.env.PROOF_OUTPUT!,"concurrent.xlsx"),r.bytes,{mode:0o600});
      observations.push({case:"concurrent-edit",status:r.response.status,ids,values:r.inputs[0].projects,traces:r.traces});
      writeFileSync(path.join(process.env.PROOF_OUTPUT!,"observations.json"),JSON.stringify(observations,null,2));
    } finally { nativeEdit("restore"); }
  });

});
