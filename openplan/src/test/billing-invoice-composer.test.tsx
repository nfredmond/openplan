import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { InvoiceRecordComposer } from "@/components/invoicing/invoice-record-composer";
import { resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";

function resolvedBinding() {
  const resolution = resolveReimbursementProfile({
    workspaceJurisdiction: { country: "US", subdivision: "CA" },
  });
  if (resolution.kind !== "resolved") {
    throw new Error("expected the built-in registry to resolve a binding");
  }
  return resolution.binding;
}

/** The nationwide generic profile, as a Texas workspace's geography resolves it. */
function genericBinding() {
  const resolution = resolveReimbursementProfile({
    workspaceJurisdiction: { country: "US", subdivision: "TX" },
  });
  if (resolution.kind !== "resolved") {
    throw new Error("expected the built-in registry to resolve the nationwide generic binding");
  }
  return resolution.binding;
}

describe("InvoiceRecordComposer", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates the net request preview live from gross amount and retention", () => {
    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[{ id: "project-1", name: "Nevada County ATP" }]}
      />
    );

    const grossAmountInput = screen.getByLabelText("Gross amount");
    const retentionPercentInput = screen.getByLabelText("Retention %");
    const previewCard = screen.getByText("Net request preview").closest("aside");

    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);
    expect(preview.getByText("Gross amount")).toBeInTheDocument();
    expect(preview.getByText("Retention (0.00%)")).toBeInTheDocument();
    expect(preview.getAllByText("$0.00")).toHaveLength(3);

    fireEvent.change(grossAmountInput, { target: { value: "12500" } });
    fireEvent.change(retentionPercentInput, { target: { value: "5" } });

    expect(preview.getByText("Retention (5.00%)")).toBeInTheDocument();
    expect(preview.getByText("$12,500.00")).toBeInTheDocument();
    expect(preview.getByText("$625.00")).toBeInTheDocument();
    expect(preview.getByText("$11,875.00")).toBeInTheDocument();
  });

  it("shows gross as net when retention is zero", () => {
    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
      />
    );

    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "3200" } });

    expect(screen.getByText("Retention (0.00%)")).toBeInTheDocument();
    expect(screen.getAllByText("$3,200.00")).toHaveLength(2);
  });

  it("drives the posture select and submitted-to hint from the resolved profile", () => {
    const binding = resolvedBinding();

    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
        reimbursementProfile={binding}
      />
    );

    const postureSelect = screen.getByLabelText(
      `Reimbursement stage — ${binding.profileName}`
    ) as HTMLSelectElement;
    expect(postureSelect.value).toBe(binding.defaultPostureId);
    expect(Array.from(postureSelect.options).map((option) => option.value)).toEqual(
      binding.postureOptions.map((option) => option.postureId)
    );
    expect(Array.from(postureSelect.options).map((option) => option.textContent)).toEqual(
      binding.postureOptions.map((option) => option.label)
    );
    expect(screen.getByLabelText("Submitted to")).toHaveAttribute(
      "placeholder",
      binding.submittedToHint ?? ""
    );
  });

  it("submits the chosen posture but never a profile id — provenance belongs to the server", async () => {
    // If the composer echoed the page-resolved profile id back, the server
    // would stamp the row `explicitly_requested` — an explicit choice nobody
    // made. The UI payload carries the posture only; the server re-resolves
    // the profile from workspace geography and records the true selection.
    const binding = resolvedBinding();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
        reimbursementProfile={binding}
      />
    );

    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "OP-2026-101" } });
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /Save invoice record/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const payload = JSON.parse(requestInit.body) as Record<string, unknown>;
    expect(payload.reimbursementPosture).toBe(binding.defaultPostureId);
    expect(payload).not.toHaveProperty("reimbursementProfileId");
  });

  it("renders the generic profile's framing note and documentation checklist", () => {
    // The nationwide profile's honesty line — the executed agreement wins —
    // and its pre-submission checklist must be visible where the draw is
    // being logged, because that is where a wrong assumption becomes a claim.
    const binding = genericBinding();
    if (!binding.framingNote || !binding.documentationChecklist) {
      throw new Error("expected the generic profile to carry a framing note and checklist");
    }

    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
        reimbursementProfile={binding}
      />
    );

    expect(screen.getByText(binding.framingNote)).toBeInTheDocument();
    expect(screen.getByText("Before submitting a reimbursement packet")).toBeInTheDocument();
    for (const item of binding.documentationChecklist) {
      expect(screen.getByText(`${item.label}.`)).toBeInTheDocument();
    }
    // The generic profile has no funder office to hint, so the neutral
    // placeholder stands.
    expect(screen.getByLabelText("Submitted to")).toHaveAttribute(
      "placeholder",
      "Funder or program office"
    );
  });

  it("renders no framing note or checklist for a profile that declares none", () => {
    // The LAPM profile carries neither field; its rendering is unchanged.
    const binding = resolvedBinding();
    expect(binding.framingNote).toBeNull();
    expect(binding.documentationChecklist).toBeNull();

    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
        reimbursementProfile={binding}
      />
    );

    expect(screen.queryByText("Before submitting a reimbursement packet")).toBeNull();
    expect(screen.queryByText(/executed funding agreement controls/)).toBeNull();
  });

  it("omits the posture select and shows a neutral hint when no profile is resolved", () => {
    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
      />
    );

    expect(screen.queryByLabelText(/Reimbursement stage/)).toBeNull();
    expect(screen.getByLabelText("Submitted to")).toHaveAttribute(
      "placeholder",
      "Funder or program office"
    );
  });
});
