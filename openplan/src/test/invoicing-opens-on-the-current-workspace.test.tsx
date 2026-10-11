import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
  INVOICES OPEN ON THE WORKSPACE THE HEADER SHOWS (October 10, 2026).

  The page stopped every planner with more than one workspace at "Choose a
  workspace", although the header already named their current one. It now
  opens that workspace's register and names it; an explicit ?workspaceId
  still wins. The registers themselves are stood in for here: their reads
  are covered by invoicing-read-failures.test.tsx.
*/
const membershipsEqMock = vi.fn();
const loadCurrentMock = vi.fn();

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table !== "workspace_members") throw new Error(`Unexpected table: ${table}`);
      return { select: () => ({ eq: membershipsEqMock }) };
    },
  }),
}));
vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return { ...actual, loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentMock(...args) };
});
vi.mock("@/app/(app)/invoicing/_components/invoicing-cash-strip", () => ({
  InvoicingCashStrip: ({ workspaceId }: { workspaceId: string }) => <div data-testid="cash-strip">{workspaceId}</div>,
}));
vi.mock("@/app/(app)/invoicing/_components/reimbursement-lane", () => ({
  ReimbursementLane: () => <div data-testid="reimbursement-lane" />,
}));
vi.mock("@/app/(app)/invoicing/_components/receivables-lane", () => ({
  ReceivablesLane: () => <div data-testid="receivables-lane" />,
}));

import InvoicingPage from "@/app/(app)/invoicing/page";

const MEMBERSHIPS = [
  { workspace_id: "ws-a", role: "owner", workspaces: { name: "County Transportation", created_at: "2026-01-01" } },
  { workspace_id: "ws-b", role: "owner", workspaces: { name: "City Streets", created_at: "2026-02-01" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  membershipsEqMock.mockResolvedValue({ data: MEMBERSHIPS, error: null });
  loadCurrentMock.mockResolvedValue({ membership: MEMBERSHIPS[1], workspace: { id: "ws-b", name: "City Streets" } });
});

describe("invoices open on the current workspace", () => {
  it("opens the header's workspace instead of asking which one", async () => {
    render(await InvoicingPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByText("Choose a workspace")).not.toBeInTheDocument();
    expect(screen.getByTestId("cash-strip")).toHaveTextContent("ws-b");
    expect(screen.getByText("City Streets")).toBeInTheDocument();
  });

  it("lets an explicit workspace in the address win", async () => {
    render(await InvoicingPage({ searchParams: Promise.resolve({ workspaceId: "ws-a" }) }));

    expect(screen.getByTestId("cash-strip")).toHaveTextContent("ws-a");
    expect(loadCurrentMock).not.toHaveBeenCalled();
  });

  it("still stops on an address naming a workspace this account is not in", async () => {
    render(await InvoicingPage({ searchParams: Promise.resolve({ workspaceId: "ws-unknown" }) }));

    expect(screen.queryByTestId("cash-strip")).not.toBeInTheDocument();
  });
});
