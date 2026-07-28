import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { ClientInvoiceComposer } from "@/components/invoicing/client-invoice-composer";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENGAGEMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseProps = {
  workspaceId: WORKSPACE_ID,
  canWrite: true,
  clients: [{ id: CLIENT_ID, name: "River City" }],
  engagements: [
    {
      id: ENGAGEMENT_ID,
      clientId: CLIENT_ID,
      projectId: null,
      title: "Corridor study on-call",
      notToExceedAmount: 50000,
    },
  ],
  projects: [],
  deliverables: [],
  rateTables: [
    {
      id: "rt-1",
      engagementId: ENGAGEMENT_ID,
      entries: [{ laborCategory: "Senior Planner", hourlyRate: 180 }],
    },
    {
      id: "rt-2",
      engagementId: null,
      entries: [{ laborCategory: "Associate Planner", hourlyRate: 120 }],
    },
  ],
  staff: [
    { id: "staff-1", name: "Jane Doe" },
    { id: "staff-2", name: "Ada Park" },
  ],
};

const unbilledEntries = [
  { id: "te-1", staff_id: "staff-1", labor_category: "Senior Planner", hours: 2, billable: true, billed_line_item_id: null },
  { id: "te-2", staff_id: "staff-1", labor_category: "Senior Planner", hours: 3, billable: true, billed_line_item_id: null },
  { id: "te-3", staff_id: "staff-2", labor_category: "GIS Analyst", hours: 4, billable: true, billed_line_item_id: null },
];

function stubFetch({ nteWarning }: { nteWarning?: { billedToDate: number; notToExceed: number; overBy: number } } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === "GET") {
      expect(url).toContain("/api/invoicing/time-entries?");
      return { ok: true, json: async () => ({ timeEntries: unbilledEntries, hasMore: false }) };
    }
    return { ok: true, json: async () => ({ invoice: { id: "inv-1" }, lineItems: [], nteWarning }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fillRequiredHeader() {
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: CLIENT_ID } });
  fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-2026-014" } });
}

async function pullUnbilledTime() {
  fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: ENGAGEMENT_ID } });
  fireEvent.click(screen.getByRole("button", { name: "Pull unbilled time" }));
  await waitFor(() => expect(screen.getByText(/draft lines pulled from 3 unbilled time entries/)).toBeInTheDocument());
}

describe("ClientInvoiceComposer", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes line amounts and invoice totals live with the shared helpers", () => {
    render(<ClientInvoiceComposer {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/Description \(line 1\)/), { target: { value: "Planning services" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Unit rate"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Retention %"), { target: { value: "10" } });

    const aside = screen.getByText("Invoice totals").closest("aside") as HTMLElement;
    const totals = within(aside);
    expect(totals.getByText("$1,500.00")).toBeInTheDocument();
    expect(totals.getByText("Retention (10.00%)")).toBeInTheDocument();
    expect(totals.getByText("$150.00")).toBeInTheDocument();
    expect(totals.getByText("$1,350.00")).toBeInTheDocument();
  });

  it("pulls unbilled time into grouped draft lines with rate sources disclosed", async () => {
    stubFetch();
    render(<ClientInvoiceComposer {...baseProps} />);
    fillRequiredHeader();
    await pullUnbilledTime();

    // Rated group: 5 hours of Senior Planner priced from the engagement table.
    expect(screen.getByDisplayValue("Senior Planner — Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Senior Planner — $180.00/hour from the engagement rate table")).toBeInTheDocument();
    // Rateless group is flagged, never priced.
    expect(screen.getByDisplayValue("GIS Analyst — Ada Park")).toBeInTheDocument();
    expect(screen.getByText("GIS Analyst — no rate found in any table; enter the amount manually")).toBeInTheDocument();
    expect(screen.getByText("No rate found — enter the amount manually.")).toBeInTheDocument();
  });

  it("refuses to submit while a rateless pulled line has no manual amount", async () => {
    const fetchMock = stubFetch();
    render(<ClientInvoiceComposer {...baseProps} />);
    fillRequiredHeader();
    await pullUnbilledTime();

    fireEvent.click(screen.getByRole("button", { name: "Save client invoice" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Enter a manual amount for every pulled line without a rate — rates are never invented/)
      ).toBeInTheDocument()
    );
    // Only the GET for time entries ran; no invoice POST.
    expect(fetchMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST")).toHaveLength(0);
  });

  it("submits the contract payload with sourceTimeEntryIds once the manual amount is set", async () => {
    const fetchMock = stubFetch();
    render(<ClientInvoiceComposer {...baseProps} />);
    fillRequiredHeader();
    await pullUnbilledTime();

    fireEvent.change(screen.getByPlaceholderText("Required — no rate found"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Save client invoice" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === "POST")).toBe(true)
    );

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === "POST"
    ) as unknown as [string, { body: string }];
    expect(postCall[0]).toBe("/api/invoicing/client-invoices");
    const payload = JSON.parse(postCall[1].body) as {
      workspaceId: string;
      clientId: string;
      engagementId: string;
      invoiceNumber: string;
      lineItems: Array<Record<string, unknown>>;
    };

    expect(payload.workspaceId).toBe(WORKSPACE_ID);
    expect(payload.clientId).toBe(CLIENT_ID);
    expect(payload.engagementId).toBe(ENGAGEMENT_ID);
    expect(payload.invoiceNumber).toBe("INV-2026-014");
    // The untouched starter line is dropped; only the two pulled groups remain.
    expect(payload.lineItems).toHaveLength(2);

    const rated = payload.lineItems.find((line) => line.description === "Senior Planner — Jane Doe");
    expect(rated).toMatchObject({
      quantity: 5,
      unitLabel: "hour",
      unitAmount: 180,
      sourceTimeEntryIds: ["te-1", "te-2"],
    });
    expect(rated).not.toHaveProperty("amount");

    const rateless = payload.lineItems.find((line) => line.description === "GIS Analyst — Ada Park");
    expect(rateless).toMatchObject({
      quantity: 4,
      unitLabel: "hour",
      amount: 400,
      sourceTimeEntryIds: ["te-3"],
    });
    expect(rateless).not.toHaveProperty("unitAmount");

    await waitFor(() => expect(screen.getByText("Client invoice saved as draft.")).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("renders the server's not-to-exceed overrun as a warning, never a block", async () => {
    stubFetch({ nteWarning: { billedToDate: 61000, notToExceed: 50000, overBy: 11000 } });
    render(<ClientInvoiceComposer {...baseProps} />);
    fillRequiredHeader();
    await pullUnbilledTime();

    fireEvent.change(screen.getByPlaceholderText("Required — no rate found"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Save client invoice" }));

    await waitFor(() =>
      expect(
        screen.getByText(/\$61,000\.00 billed against its \$50,000\.00 not-to-exceed — \$11,000\.00 over\. Recorded as a warning; nothing was blocked\./)
      ).toBeInTheDocument()
    );
    // The save still succeeded alongside the warning.
    expect(screen.getByText("Client invoice saved as draft.")).toBeInTheDocument();
  });
});
