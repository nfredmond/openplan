import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { InvoiceRecordComposer } from "@/components/invoicing/invoice-record-composer";

/**
 * The consulting invoice record, as a flow.
 *
 * Three things had to survive the move and are the ones a conversion loses:
 * the LIVE net-request figure, the funding award CLEARING ITSELF when it does
 * not belong to the chosen project, and the read-only branch for a member role.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECTS = [
  { id: "p-1", name: "Ridge Road corridor" },
  { id: "p-2", name: "Bridge study" },
];
const AWARDS = [
  { id: "a-1", title: "SS4A implementation", projectId: "p-1" },
  { id: "a-2", title: "Bridge programme award", projectId: "p-2" },
  // No project of its own: valid against any project, and against none.
  { id: "a-3", title: "Workspace-wide formula award", projectId: null },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

function openToLinks(canWrite = true) {
  render(
    <InvoiceRecordComposer
      workspaceId={WORKSPACE}
      projects={PROJECTS}
      fundingAwards={AWARDS}
      canWrite={canWrite}
    />
  );
  fireEvent.click(screen.getByTestId("invoice-record-composer-open"));
  fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "OP-2026-001" } });
  next();
}

describe("logging a consulting invoice record", () => {
  it("stays read-only for a member role, with no way in", () => {
    render(
      <InvoiceRecordComposer
        workspaceId={WORKSPACE}
        projects={PROJECTS}
        fundingAwards={AWARDS}
        canWrite={false}
      />
    );

    expect(screen.getByText("Read-only for member role")).toBeInTheDocument();
    expect(screen.queryByTestId("invoice-record-composer-open")).toBeNull();
  });

  it("is behind a button when writing is allowed", () => {
    render(
      <InvoiceRecordComposer
        workspaceId={WORKSPACE}
        projects={PROJECTS}
        fundingAwards={AWARDS}
        canWrite
      />
    );
    expect(screen.getByTestId("invoice-record-composer-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoice number")).toBeNull();
  });

  it("works the net request out as you type, beside the fields it comes from", () => {
    openToLinks();
    next();

    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Retention %"), {
      target: { value: "10" },
    });

    // 10% of 10,000 held back leaves 9,000 requested.
    expect(screen.getByTestId("invoice-net-request").textContent).toContain("9,000");
  });

  it("drops a funding award that does not belong to the chosen project", () => {
    openToLinks();

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-1" } });
    fireEvent.change(screen.getByLabelText("Funding award"), { target: { value: "a-1" } });
    expect(screen.getByLabelText("Funding award")).toHaveValue("a-1");

    // Switching project invalidates that award; leaving it selected would file
    // an invoice against another project's money.
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-2" } });
    expect(screen.getByLabelText("Funding award")).toHaveValue("");
    // And only the new project's award is offered.
    expect(screen.getByRole("option", { name: "Bridge programme award" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "SS4A implementation" })).toBeNull();
  });

  it("does not SUBMIT an award from the project it was abandoned for", async () => {
    // THE ASSERTION THAT ACTUALLY BITES, found by a mutation that survived the
    // one above. Removing the clearing rule leaves the select LOOKING empty —
    // the stale award is filtered out of its options, so the DOM shows "" —
    // while the flow still holds it and submits it. An invoice filed against
    // another project's money, with nothing on screen disagreeing.
    openToLinks();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-1" } });
    fireEvent.change(screen.getByLabelText("Funding award"), { target: { value: "a-1" } });
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-2" } });

    next();
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "100" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Save the invoice record" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.projectId).toBe("p-2");
    expect(body.fundingAwardId).toBeUndefined();
  });

  it("keeps an award that is still valid for the new project", () => {
    // An award with no project of its own belongs to every project, so
    // switching must NOT clear it. A clearing rule that fired on any project
    // change would throw away a correct answer.
    openToLinks();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-1" } });
    fireEvent.change(screen.getByLabelText("Funding award"), { target: { value: "a-3" } });
    expect(screen.getByLabelText("Funding award")).toHaveValue("a-3");

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-2" } });
    expect(screen.getByLabelText("Funding award")).toHaveValue("a-3");
  });

  it("posts the same keys the inline form posted", async () => {
    openToLinks();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-1" } });
    next();
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText("Retention %"), { target: { value: "5" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Save the invoice record" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/invoicing/invoices");
    const body = JSON.parse(String(init.body));
    expect(body.workspaceId).toBe(WORKSPACE);
    expect(body.invoiceNumber).toBe("OP-2026-001");
    expect(body.projectId).toBe("p-1");
    expect(body.amount).toBe(12500);
    expect(body.retentionPercent).toBe(5);
    expect(body.status).toBe("draft");
    expect(body.supportingDocsStatus).toBe("pending");
    // Raw, as the inline form sent them.
    expect(body.consultantName).toBe("");
    expect(body.submittedTo).toBe("");
    expect(body.notes).toBe("");
    // The server re-resolves the profile; the client never names it.
    expect("reimbursementProfileId" in body).toBe(false);
  });

  it("refuses an amount that is not a plain number", () => {
    openToLinks();
    next();
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "-5" } });
    next();

    expect(
      screen.getAllByText(/Give the gross amount as a plain number/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a period that ends before it starts", () => {
    openToLinks();
    next();
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "100" } });
    next();
    fireEvent.change(screen.getByLabelText("Period start"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Period end"), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the invoice record" }));

    expect(
      screen.getAllByText(/period cannot end before it starts/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's specific reason when it refuses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Failed to save invoice record",
        details: "Invoice number OP-2026-001 already exists in this workspace.",
      }),
    });

    openToLinks();
    next();
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "100" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Save the invoice record" }));

    expect(
      await screen.findByText(/already exists in this workspace/i)
    ).toBeInTheDocument();
  });
});
