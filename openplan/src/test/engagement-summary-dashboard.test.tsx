import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { EngagementNteBar } from "@/components/invoicing/engagement-nte-bar";
import type { EngagementBilledSummary } from "@/lib/invoicing/receivables";

const { rpc, calls, results } = vi.hoisted(() => ({
  rpc: vi.fn(), calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  results: new Map<string, { data: unknown; error: null }>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: (table: string) => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) chain[method] = (...args: unknown[]) => {
    calls.push({ table, method, args }); return chain;
  };
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results.get(table) ?? { data: [], error: null }).then(resolve);
  return chain;
} }) }));
import { ReceivablesLane } from "@/app/(app)/invoicing/_components/receivables-lane";

function summaries(node: ReactNode): EngagementBilledSummary[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ summary?: EngagementBilledSummary; children?: ReactNode }>(child)) return [];
    return child.type === EngagementNteBar && child.props.summary ? [child.props.summary] : summaries(child.props.children);
  });
}

describe("ESComplete dashboard caller", () => {
  beforeEach(() => {
    calls.length = 0; results.clear(); rpc.mockReset();
    results.set("invoicing_clients", { data: [{ id: "client-1", name: "Client", client_kind: "agency" }], error: null });
    results.set("invoicing_engagements", { data: [{ id: "eng-1", client_id: "client-1", title: "Legacy engagement", status: "active", engagement_kind: "contract", not_to_exceed_amount: "1" }], error: null });
    results.set("client_invoices", { data: Array.from({ length: 500 }, (_, i) => ({ id: `invoice-${i}`, client_id: "client-1", engagement_id: "eng-1", status: "draft", subtotal_amount: 0 })), error: null });
    rpc.mockResolvedValue({ data: { version: 1, workspace_id: "workspace-1", engagement_id: null, exclude_invoice_id: null, complete: true, error: null,
      data: [{ engagement_id: "eng-1", not_to_exceed_amount: "1", billed: { amount: "501", missing: "0", invalid: "0" }, draft: { amount: "7", missing: "0", invalid: "0" } }] }, error: null });
  });
  it("uses the workspace snapshot independently of its 500-row register and asserts actual list projection", async () => {
    const tree = await ReceivablesLane({ workspaceId: "workspace-1", canWriteInvoices: false });
    expect(summaries(tree)).toEqual([expect.objectContaining({ billedToDate: 501, draftedUnbilled: 7, remaining: -500, source: { state: "complete" } })]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("engagement_billed_summaries_v1", { p_workspace_id: "workspace-1", p_engagement_id: null, p_exclude_invoice_id: null });
    expect(calls.filter((call) => call.table === "client_invoices")).toEqual([
      { table: "client_invoices", method: "select", args: ["id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, currency_code, notes, created_at"] },
      { table: "client_invoices", method: "eq", args: ["workspace_id", "workspace-1"] },
      { table: "client_invoices", method: "order", args: ["created_at", { ascending: false }] },
      { table: "client_invoices", method: "limit", args: [500] },
    ]);
  });
  it("does not turn a failed workspace summary into totals from the visible register", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });
    const tree = await ReceivablesLane({ workspaceId: "workspace-1", canWriteInvoices: false });
    expect(summaries(tree)).toEqual([expect.objectContaining({ billedToDate: null, draftedUnbilled: null, remaining: null, source: { state: "unavailable", error: { code: "42501", message: "permission denied" } } })]);
  });
});
