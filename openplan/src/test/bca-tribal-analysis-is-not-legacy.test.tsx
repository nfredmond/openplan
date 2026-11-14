/**
 * A NEW BENEFIT-COST ANALYSIS ON A TRIBAL AREA IS NOT CALLED LEGACY
 * (KI-2026-11-14-116).
 *
 * The agent-run browser check opened the workbench on a project whose place is
 * a tribal area and saw "Unbound legacy analysis" on a blank analysis. The
 * analysis was new. It had no place because the saved-analysis rule did not
 * admit that place kind. The workbench and the method export now say the
 * analysis has no place whenever the project's place cannot be read, and leave
 * the reason to the project-place line.
 *
 * Migration 20261102100000 (PR 408) widens the saved-analysis rule to every
 * place kind the project picker offers, so a tribal area now reads as a place
 * an analysis can record. The first test below holds that; the "no place"
 * wording is tested with a project place that could not be read.
 *
 * Blind category: the browser render at 390 px; an imported legacy file on a
 * project whose place cannot be read, which is also labeled "This analysis has
 * no place" (true, but it does not say legacy); the database rule itself.
 */
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BcaWorkbench } from "@/components/grants/bca-workbench/workbench";
import { newBcaDocument } from "@/lib/bca/workbench/document";
import { exportBcaPackage } from "@/lib/bca/workbench/export";
import { bcaPlaceReview, readBcaProjectPlace } from "@/lib/bca/workbench/project-place";
import { bcaActorId, bcaProjectId, bcaProjectPlace, bcaProjectRow } from "./fixtures/bca/project-place";

/** The project as the browser check saw it: its place is a tribal area. */
function tribalProjectPlace() {
  return readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), place_source: "tigerweb", place_kind: "aiannh", place_ref: "2430R",
    place_label: "Synthetic tribal area", place_country_code: "US", place_set_at: "2026-10-19T00:00:00Z",
    place_min_lon: 1, place_min_lat: 1, place_max_lon: 2, place_max_lat: 2 });
}

/** A project whose place and context could not be read. */
const UNREAD_PLACE = { status: "unavailable" as const, message: "The project's place and context were not fully read." };

const props = { projectId: bcaProjectId, projectName: "Synthetic project", userId: bcaActorId, canSave: true, models: [],
  modelReadFailed: false, latestSaved: { status: "none" as const } };

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

describe("a new analysis on a tribal-area project, and on a project whose place cannot be read", () => {
  it("reads a tribal area as a place an analysis can record", () => {
    const read = tribalProjectPlace();
    expect(read.status).toBe("available");
    render(<BcaWorkbench {...props} projectPlace={read} />);
    expect(screen.queryByText("This analysis has no place.")).toBeNull();
    expect(screen.queryByText(/legacy/i)).toBeNull();
    expect(screen.queryByText(/cannot yet record/)).toBeNull();
  });

  it("says the analysis has no place, not that the analysis is legacy, and keeps the reason beside it", () => {
    render(<BcaWorkbench {...props} projectPlace={UNREAD_PLACE} />);
    expect(screen.getByText("This analysis has no place.")).toBeVisible();
    expect(screen.queryByText(/legacy/i)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(UNREAD_PLACE.message);
  });

  it("still calls an unbound analysis legacy when the project place can be read", () => {
    render(<BcaWorkbench {...props} projectPlace={{ status: "available", snapshot: bcaProjectPlace() }}
      latestSaved={{ status: "found", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: "2026-10-19T00:00:00Z", document: newBcaDocument(bcaProjectId) }} />);
    expect(screen.getByText(/Unbound legacy analysis/)).toBeVisible();
  });

  it("says the same in the method export", async () => {
    const doc = newBcaDocument(bcaProjectId);
    const zip = await JSZip.loadAsync(await exportBcaPackage(doc, {}, bcaPlaceReview(doc, UNREAD_PLACE)));
    const memo = await zip.file("method-and-review.md")!.async("string");
    expect(memo).toContain("This analysis has no place.");
    expect(memo).not.toContain("legacy");
  });
});
