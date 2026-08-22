import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { WorkPlanTemplateApplier } from "@/components/projects/work-plan-template-applier";
import type { WorkPlanTemplateDescriptor } from "@/lib/work-plans/template-registry";

/**
 * Applying a work-plan template creates a dozen records at once, so two things
 * have to survive the move into a flow:
 *
 *  - THE CONSENT PANEL. What the template is for, what it will make, and whose
 *    rules it was written against. It is what a planner reads before agreeing,
 *    and it now sits on the step that submits — the last thing seen before the
 *    records exist.
 *  - THE RESULT, INCLUDING WHAT WAS SKIPPED. The only place anyone learns that
 *    records already existed under the same titles and were not duplicated. The
 *    flow closes on success, so it lives on the panel.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const PROJECTS = [{ id: "p-1", name: "Ridge Road corridor" }];

const TEMPLATE = {
  templateId: "t-1",
  templateName: "Corridor study starter",
  practiceArea: "transportation" as const,
  anchor: "notice_to_proceed" as const,
  spanDays: 180,
  description: "A starter plan for a corridor study.",
  scopeNotes: ["Assumes a consultant-led schedule."],
  deliverableCount: 6,
  milestoneCount: 3,
  jurisdiction: { code: "CA", label: "California" },
  templateVersion: 1,
  appliesToPlanTypes: ["corridor"],
} as unknown as WorkPlanTemplateDescriptor;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      createdDeliverables: 6,
      createdMilestones: 3,
      skippedDeliverableTitles: ["Existing conditions memo"],
      skippedMilestoneTitles: [],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

function openToDate() {
  render(<WorkPlanTemplateApplier projects={PROJECTS} templates={[TEMPLATE]} />);
  fireEvent.click(screen.getByTestId("work-plan-applier-open"));
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p-1" } });
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "t-1" } });
  next();
}

describe("applying a work-plan template", () => {
  it("is behind a button, not open on the projects page", () => {
    render(<WorkPlanTemplateApplier projects={PROJECTS} templates={[TEMPLATE]} />);
    expect(screen.getByTestId("work-plan-applier-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Project")).toBeNull();
  });

  it("shows what will be created before it is created", () => {
    openToDate();
    const dialog = document.querySelector("dialog")?.textContent ?? "";

    expect(dialog).toContain("Before you apply this");
    expect(dialog).toContain("A starter plan for a corridor study.");
    expect(dialog).toContain("Assumes a consultant-led schedule.");
    expect(dialog).toContain("6 deliverables and 3 milestones will be created");
    // Whose rules it was written against — a template used elsewhere unchecked
    // is the risk this sentence exists for.
    expect(dialog).toContain("Written for California");
  });

  it("names the anchor in the template's own words", () => {
    openToDate();
    // The label is the template's anchor, not a generic "Anchor date".
    expect(screen.queryByLabelText("Anchor date")).toBeNull();
    expect(document.querySelector("dialog")?.textContent ?? "").toContain(
      "the last one lands 180 days later"
    );
  });

  it("will not apply a template without a date", () => {
    // NAMED FOR WHAT IT PROVES. It was called "refuses a date that is not a
    // real calendar day", and a mutation removing the anchor's `YYYY-MM-DD`
    // check still passed it — because a `type="date"` input only ever yields
    // "" or a valid date, so what rejects "2026-13" is the REQUIRED check, not
    // the shape one. The shape check stays as a backstop for a value that never
    // came from that input; nothing here claims to exercise it.
    openToDate();
    fireEvent.click(screen.getByRole("button", { name: "Apply work plan" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/Give the day this template's dates are counted from/i).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("posts the template and the anchor to the chosen project", async () => {
    openToDate();
    fireEvent.change(screen.getByLabelText(/notice to proceed/i), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply work plan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p-1/work-plan");
    expect(JSON.parse(String(init.body))).toEqual({
      templateId: "t-1",
      anchorDate: "2026-09-01",
    });
  });

  it("keeps the result — and what was skipped — after the flow closes", async () => {
    openToDate();
    fireEvent.change(screen.getByLabelText(/notice to proceed/i), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply work plan" }));

    const applied = await screen.findByTestId("work-plan-applied");
    expect(applied.textContent).toContain("6 deliverables and 3 milestones created");
    // The duplicates nobody would otherwise hear about.
    expect(applied.textContent).toContain("1 record already existed");
    expect(applied.textContent).toContain("Existing conditions memo");
  });

  it("shows the server's specific reason when it refuses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "The work plan could not be applied.",
        details: "That project already has a work plan from this template.",
      }),
    });

    openToDate();
    fireEvent.change(screen.getByLabelText(/notice to proceed/i), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply work plan" }));

    expect(
      await screen.findByText(/already has a work plan from this template/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("work-plan-applied")).toBeNull();
  });
});
