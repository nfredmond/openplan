import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  confirmDestructiveAction,
  confirmDialogText,
  declineConfirmation,
} from "./helpers/confirm-dialog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { ClientInvoiceStatusControl } from "@/components/invoicing/client-invoice-status-control";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function renderControl(status: string, canWrite = true) {
  return render(
    <ClientInvoiceStatusControl
      workspaceId={WORKSPACE_ID}
      invoiceId="inv-1"
      invoiceNumber="INV-2026-001"
      status={status}
      canWrite={canWrite}
    />
  );
}

describe("ClientInvoiceStatusControl", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers only the next lifecycle step for each status", () => {
    const { unmount } = renderControl("draft");
    expect(screen.getByRole("button", { name: "Mark sent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
    expect(screen.getByRole("button", { name: "Void…" })).toBeInTheDocument();
    unmount();

    const second = renderControl("sent");
    expect(screen.queryByRole("button", { name: "Mark sent" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeInTheDocument();
    second.unmount();

    const third = renderControl("void");
    expect(screen.queryByRole("button", { name: /Mark|Void/ })).toBeNull();
    third.unmount();

    renderControl("sent", false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("always links the on-demand PDF for the invoice", () => {
    renderControl("draft", false);
    const link = screen.getByRole("link", { name: "Download PDF" });
    expect(link).toHaveAttribute("href", "/api/invoicing/client-invoices/inv-1/pdf");
  });

  it("PATCHes the sent transition and refreshes the register", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    renderControl("draft");
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("/api/invoicing/client-invoices/inv-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({ status: "sent" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("confirms void in the app's own dialog, naming the un-stamping consequence, and respects a decline", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    renderControl("sent");
    fireEvent.click(screen.getByRole("button", { name: "Void…" }));

    // The wording that used to live in a browser dialog is now on the page,
    // where it can be themed, read by a screen reader, and asserted on as text.
    const copy = await confirmDialogText();
    expect(copy).toContain("INV-2026-001");
    expect(copy).toContain("returns to the unbilled pool");
    expect(copy).toContain("number stays claimed");

    await declineConfirmation();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Void…" }));
    await confirmDestructiveAction("Void this invoice");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ status: "void" });
  });

  it("surfaces a failed transition instead of refreshing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Lines are immutable once sent" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderControl("draft");
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));

    await waitFor(() => expect(screen.getByText("Lines are immutable once sent")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
