import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { engagementSummaryFor, loadEngagementBilledSummaries, type EngagementSummaryClient } from "@/lib/invoicing/engagement-summary-queries";
import { EngagementNteBar } from "@/components/invoicing/engagement-nte-bar";

const scope = { workspaceId: "workspace-1", engagementId: "engagement-1" };
function snapshot(billed: string | null = "0", draft: string | null = "0", ceiling: string | null = "0") {
  return { version: 1, workspace_id: scope.workspaceId, engagement_id: scope.engagementId as string | null,
    exclude_invoice_id: null as string | null, complete: true, error: null,
    data: [{ engagement_id: scope.engagementId, not_to_exceed_amount: ceiling,
      billed: { amount: billed, missing: "0", invalid: "0" }, draft: { amount: draft, missing: "0", invalid: "0" } }] };
}
async function read(data: unknown, error: { code?: string; message: string } | null = null) {
  const rpc = vi.fn<EngagementSummaryClient["rpc"]>().mockResolvedValue({ data, error });
  return { result: await loadEngagementBilledSummaries({ rpc }, scope), rpc };
}

describe("ESComplete snapshot reader", () => {
  it("binds workspace, engagement and excluded invoice identity without a row-query fallback", async () => {
    const data = snapshot("10", "2", "20"); data.exclude_invoice_id = "current-invoice";
    const rpc = vi.fn<EngagementSummaryClient["rpc"]>().mockResolvedValue({ data, error: null });
    const result = await loadEngagementBilledSummaries({ rpc }, { ...scope, excludeInvoiceId: "current-invoice" });
    expect(result.state).toBe("complete");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("engagement_billed_summaries_v1", {
      p_workspace_id: "workspace-1", p_engagement_id: "engagement-1", p_exclude_invoice_id: "current-invoice",
    });
    expect(engagementSummaryFor(result, { id: scope.engagementId }).remaining).toBe(10);
  });
  for (const [count, billed, remaining] of [
    [501, "500999999999994.99", "-499999999999995.00"],
    [1201, "1200999999999987.99", "-1199999999999988.00"],
  ] as const) {
    it(`retains aggregate text for ${count} legal NUMERIC(14,2) contributors beyond safe aggregate cents`, async () => {
      // A finite supplied corpus establishes the independent literal expectation.
      // The mocked scalar is not evidence that PostgreSQL executes this aggregate.
      const corpus = Array.from({ length: count }, () => "999999999999.99");
      const expectedCents = corpus.reduce((sum, value) => sum + BigInt(value.replace(".", "")), BigInt(0));
      expect(expectedCents.toString()).toBe(billed.replace(".", ""));
      expect(expectedCents > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
      const { result } = await read(snapshot(billed, billed, "999999999999.99"));
      const summary = JSON.parse(JSON.stringify(engagementSummaryFor(result, { id: scope.engagementId })));
      expect(summary.billedToDate).toBe(billed);
      expect(summary.draftedUnbilled).toBe(billed);
      const remainingText = String(summary.remaining);
      const [whole, fraction = ""] = remainingText.split(".");
      expect(whole + fraction.padEnd(2, "0")).toBe(remaining.replace(".", ""));
      expect(summary.isOverNte).toBe(true);
    });
  }
  it("keeps recorded zero, absent ceiling and unknown source distinct", async () => {
    const zero = await read(snapshot());
    expect(engagementSummaryFor(zero.result, { id: scope.engagementId })).toMatchObject({ billedToDate: 0, draftedUnbilled: 0, notToExceed: 0, remaining: 0 });
    const absent = await read(snapshot("0", "0", null));
    expect(engagementSummaryFor(absent.result, { id: scope.engagementId }).notToExceed).toBeNull();
    const missing = await read(null);
    expect(engagementSummaryFor(missing.result, { id: scope.engagementId })).toMatchObject({ billedToDate: null, draftedUnbilled: null, remaining: null, isOverNte: null, source: { state: "unavailable" } });
  });
  it.each(["billed", "draft"] as const)("isolates missing and malformed %s buckets", async (which) => {
    for (const [value, missing, invalid, reason] of [
      [null, "1", "0", "missing"], ["NaN", "0", "1", "invalid"], ["2junk", "0", "0", "invalid"], ["1.001", "0", "0", "invalid"],
    ] as const) {
      const data = snapshot("7", "2", "10"); data.data[0][which] = { amount: value, missing, invalid };
      const { result } = await read(data);
      const summary = engagementSummaryFor(result, { id: scope.engagementId });
      expect(summary.billedToDate).toBe(which === "billed" ? null : 7);
      expect(summary.draftedUnbilled).toBe(which === "draft" ? null : 2);
      expect(summary.unavailable).toEqual({ [which === "billed" ? "billedToDate" : "draftedUnbilled"]: reason });
    }
  });
  it.each([
    ["PGRST202", "Could not find the function public.engagement_billed_summaries_v1(p_engagement_id, p_exclude_invoice_id, p_workspace_id) in the schema cache", "pending"],
    ["42883", "function public.engagement_billed_summaries_v1(uuid, uuid, uuid) does not exist", "pending"],
    ["42883", "function public.other_dependency(uuid) does not exist", "unavailable"],
    ["42501", "Could not find the function public.engagement_billed_summaries_v1 in the schema cache", "unavailable"],
    ["42P01", 'relation "public.client_invoices" does not exist', "unavailable"],
    ["XX000", "internal failure", "unavailable"],
  ])("preserves original %s source failure and classifies %s", async (code, message, state) => {
    const { result } = await read(null, { code, message });
    expect(result).toEqual({ state, summaries: new Map(), error: { code, message } });
    const summary = engagementSummaryFor(result, { id: scope.engagementId, not_to_exceed_amount: 10 });
    expect(summary.billedToDate).toBeNull(); expect(summary.draftedUnbilled).toBeNull(); expect(summary.remaining).toBeNull();
    expect(summary.source).toEqual({ state, error: { code, message } });
  });
  it("preserves thrown SDK code and message without reclassifying permissions", async () => {
    const rpc = vi.fn<EngagementSummaryClient["rpc"]>().mockRejectedValue({ code: "42501", message: "source permission failure" });
    const result = await loadEngagementBilledSummaries({ rpc }, scope);
    expect(result).toEqual({ state: "unavailable", summaries: new Map(), error: { code: "42501", message: "source permission failure" } });
  });
  it("preserves incomplete envelope error without treating an internal missing function as pending", async () => {
    const error = { code: "42883", message: "function public.engagement_billed_summaries_v1(uuid, uuid, uuid) does not exist" };
    const { result } = await read({ ...snapshot(), complete: false, data: null, error });
    expect(result).toEqual({ state: "unavailable", summaries: new Map(), error });
  });
  it.each(["workspace", "engagement", "exclude", "incomplete", "duplicate", "absent", "malformed"])("refuses %s snapshots as unknown money", async (fault) => {
    const data = snapshot();
    if (fault === "workspace") data.workspace_id = "foreign";
    if (fault === "engagement") data.engagement_id = "foreign";
    if (fault === "exclude") data.exclude_invoice_id = "foreign";
    if (fault === "duplicate") data.data.push(data.data[0]);
    if (fault === "absent") data.data = [];
    const input = fault === "incomplete" ? { ...data, complete: false, error: { code: "XX000", message: "partial" } } : fault === "malformed" ? { ...data, data: [{}] } : data;
    const { result } = await read(input);
    expect(result.state).toBe("unavailable"); expect(result.summaries.size).toBe(0);
    expect(engagementSummaryFor(result, { id: scope.engagementId }).billedToDate).toBeNull();
  });
  it.each(["pending", "unavailable"] as const)("renders %s without an artificial zero or currency assertion", (state) => {
    const summary = engagementSummaryFor({ state, summaries: new Map(), error: { code: "test", message: "source failed" } }, { id: scope.engagementId });
    const html = renderToStaticMarkup(<EngagementNteBar summary={summary} currencyCode={null} />);
    expect(html).toContain(state === "pending" ? "pending schema upgrade" : "source unavailable");
    expect(html).toContain("positions are unknown"); expect(html).not.toContain("0.00 gross billed");
  });
});

describe("ESComplete SQL source intent", () => {
  const sql = readFileSync("supabase/migrations/20261017000020_engagement_billed_summaries.sql", "utf8");
  it("retains stable scalar invoker security and explicit caller ACL", () => {
    expect(sql).toMatch(/RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER/);
    expect(sql).toContain("m.workspace_id = p_workspace_id AND m.user_id = auth.uid()");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.engagement_billed_summaries_v1(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.engagement_billed_summaries_v1(uuid, uuid, uuid) TO authenticated;");
    expect(sql).not.toMatch(/SECURITY DEFINER|SET ROLE|DISABLE TRIGGER|GRANT .* ON (?:TABLE|public\.client_invoices)/i);
  });
  it("aggregates scoped gross text before row caps, separately from drafts and cash", () => {
    expect(sql).toContain("coalesce(sum(i.subtotal_amount) FILTER (WHERE i.status IN ('sent', 'paid')), 0) AS billed");
    expect(sql).toContain("coalesce(sum(i.subtotal_amount) FILTER (WHERE i.status = 'draft'), 0) AS draft");
    expect(sql).toContain("'amount', a.billed::text"); expect(sql).toContain("'amount', a.draft::text");
    expect(sql).toContain("i.engagement_id = e.id AND i.workspace_id = p_workspace_id");
    expect(sql).toContain("WHERE e.workspace_id = p_workspace_id");
    expect(sql).toContain("p_engagement_id IS NULL OR e.id = p_engagement_id");
    expect(sql).toContain("p_exclude_invoice_id IS NULL OR i.id <> p_exclude_invoice_id");
    expect(sql).toContain("WHERE i.engagement_id = e.id AND i.workspace_id = p_workspace_id\n      AND (p_exclude_invoice_id IS NULL OR i.id <> p_exclude_invoice_id)");
    expect(sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b|sum\(i\.(?:total_amount|retention_amount)\)/i);
    expect(sql).toContain("RAISE EXCEPTION 'Engagement summary scope is unavailable' USING ERRCODE = '42501'");
    expect(sql).toContain("i.workspace_id <> e.workspace_id");
  });
});
