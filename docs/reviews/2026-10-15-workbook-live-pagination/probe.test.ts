import { createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient as realClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { describe, it, expect, vi } from "vitest";
import type { PortfolioRoundTripProject } from "@/lib/projects/portfolio-export";

type Row = Record<string, unknown>;
type Portfolio = { count: number; workspace: string; name: string; rows: Row[] };
type Trace = { offset: number; limit: number; select: string; scope: string | null; order: string | null; status: number; contentRange: string | null; rows: Row[] | null; error: unknown };
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

async function invoke(p: Portfolio, failLater = false) {
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
        traces.push({ offset: Number(requested.searchParams.get("offset") ?? 0), limit: Number(requested.searchParams.get("limit")),
          select: requested.searchParams.get("select") ?? "", scope: requested.searchParams.get("workspace_id"), order: requested.searchParams.get("order"),
          status: response.status, contentRange: response.headers.get("content-range"), rows: Array.isArray(body) ? body : null, error: Array.isArray(body) ? null : body });
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
  expect(membership.error, "adapter membership must use native visible row").toBeNull();
  expect(workspace.error, "adapter workspace must use native visible row").toBeNull();
  expect(membership.data?.role, "native fixture must retain viewer role").toBe("viewer");
  ctx.selected = { membership: membership.data, workspace: workspace.data };
  const response = await GET(new NextRequest("http://synthetic.invalid/api/projects/export/workbook"));
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, traces, inputs: [...ctx.inputs] };
}

function queryChecks(traces: Trace[], p: Portfolio, failLater = false) {
  let offset = 0;
  for (const [index, trace] of traces.entries()) {
    expect(trace.offset, "live paging offset must advance by actual received rows").toBe(offset);
    expect(trace.limit, "live inclusive request must end at bounded sentinel").toBe(Math.min(999, 2000 - offset) + 1);
    expect(trace.select.split(",").sort(), "native query projection must retain all exact selected columns").toEqual([...projection].sort());
    expect(trace.scope, "native query must use selected workspace").toBe("eq." + p.workspace);
    expect(trace.order, "native query must use timestamp desc and id asc").toBe("updated_at.desc,id.asc");
    if (failLater && index === 1) {
      expect(trace.status, "later page must receive native missing-column error").toBe(400);
      expect((trace.error as {code: string}).code, "later page must receive exact SQLSTATE").toBe("42703");
      continue;
    }
    expect(trace.status, "native successful page must return HTTP 200").toBe(200);
    const rows = trace.rows!;
    expect(rows.length, "native configured response cap must apply").toBe(Math.min(cap, trace.limit, Math.max(0, p.count - offset)));
    expect(trace.contentRange, "native content range must describe actual returned rows").toBe(rows.length ? `${offset}-${offset + rows.length - 1}/*` : "*/*");
    expect(canonical(rows), "native page material must equal original SQL projection and order").toEqual(canonical(originalRows(p).slice(offset, offset + rows.length)));
    offset += rows.length;
  }
  return offset;
}

function refusal(r: Awaited<ReturnType<typeof invoke>>, status: number) {
  expect(r.response.status, "route refusal must retain exact HTTP status").toBe(status);
  expect(r.response.headers.get("content-disposition"), "refusal must have no download header").toBeNull();
  expect(r.response.headers.get("content-type"), "refusal must remain JSON").toContain("application/json");
  expect(r.inputs.length, "refusal must never invoke workbook serializer").toBe(0);
}

if (process.env.PROOF_ORIGINAL === "1") describe("original native capped workbook", () => {
  for (const count of [2000, 2001]) it(`original-${count}`, async () => {
    const p=fixtures.portfolios.find(x=>x.count===count)!;
    const r=await invoke(p);
    expect(r.traces.length,"original must issue one capped read").toBe(1);
    expect(r.traces[0].limit,"original must request limit2001").toBe(2001);
    expect(r.traces[0].rows?.length,"original must truncate to native configured cap").toBe(cap);
    expect(r.response.status,"original incorrectly succeeds for truncated or oversized portfolio").toBe(200);
    expect(r.inputs.length,"original must serialize its truncated input").toBe(1);
    expect(r.inputs[0].projects.length,"original workbook must omit native rows").toBe(cap);
    const wb=XLSX.read(r.bytes,{type:"array"});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets.Projects,{header:1,blankrows:false});
    expect(rows.length,"original physical workbook must have only capped rows").toBe(cap+1);
    observations.push({case:`original-${count}`,status:r.response.status,actualRows:cap,omitted:count-cap,request:r.traces.map(t=>({...t,rows:t.rows?.map(x=>x.id)}))});
    writeFileSync(path.join(process.env.PROOF_OUTPUT!,"observations.json"),JSON.stringify(observations,null,2));
  });
});
else describe("real native capped workbook", () => {
  for (const count of [0, 1000, 2000, 2001]) it(`portfolio-${count}`, async () => {
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
      const expected = buildPortfolioRoundTripWorkbook({ ...actual, workspaceId: p.workspace, workspaceName: p.name, projects: originalRows(p) as unknown as PortfolioRoundTripProject[] });
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

  it("later-page-error", async () => {
    const p = fixtures.portfolios.find((x) => x.count === 2000)!;
    const r = await invoke(p, true);
    queryChecks(r.traces, p, true);
    expect(r.traces.length, "failed second page must stop before further reads").toBe(2);
    refusal(r, 500);
    expect(JSON.parse(Buffer.from(r.bytes).toString()).error, "native page failure must retain read refusal diagnostic").toBe("Failed to read the project portfolio");
    observations.push({ case:"later-page-error", status:r.response.status, traces:r.traces.map(t=>({...t,rows:t.rows?.map(x=>x.id)})),headers:Object.fromEntries(r.response.headers) });
    writeFileSync(path.join(process.env.PROOF_OUTPUT!, "observations.json"), JSON.stringify(observations,null,2));
  });
});
