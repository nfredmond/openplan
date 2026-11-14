/**
 * A NEW BENEFIT-COST ANALYSIS ON A TRIBAL AREA IS NOT CALLED LEGACY
 * (KI-2026-11-14-116).
 *
 * The agent-run browser check opened the workbench on a project whose place is
 * a tribal area and saw "Unbound legacy analysis" on a blank analysis. The
 * analysis is new. It has no place because the saved-analysis rule does not
 * admit that place kind yet (the rule needs a migration, not changed here).
 * The workbench and the method export now say the analysis has no place and leave
 * the reason to the project-place line, which names the place kind.
 *
 * Blind category: the browser render at 390 px; an imported legacy file on a
 * tribal project, which is also labeled "This analysis has no place" (true, but it does
 * not say legacy); the database rule itself.
 */
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BcaWorkbench } from "@/components/grants/bca-workbench/workbench";
import { newBcaDocument } from "@/lib/bca/workbench/document";
import { exportBcaPackage } from "@/lib/bca/workbench/export";
import { bcaPlaceReview, readBcaProjectPlace } from "@/lib/bca/workbench/project-place";
import { bcaActorId, bcaProjectId, bcaProjectPlace, bcaProjectRow } from "./fixtures/bca/project-place";

/** The project read as the browser check saw it: its place is a tribal area. */
function tribalProjectPlace() {
  const read = readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), place_source: "tigerweb", place_kind: "aiannh", place_ref: "2430R",
    place_label: "Synthetic tribal area", place_country_code: "US", place_set_at: "2026-10-19T00:00:00Z",
    place_min_lon: 1, place_min_lat: 1, place_max_lon: 2, place_max_lat: 2 });
  if (read.status === "available") throw new Error("A tribal area should not be recordable yet");
  return read;
}

const props = { projectId: bcaProjectId, projectName: "Synthetic project", userId: bcaActorId, canSave: true, models: [],
  modelReadFailed: false, latestSaved: { status: "none" as const } };

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

describe("a new analysis on a project whose place kind cannot be recorded yet", () => {
  it("says the analysis has no place, not that the analysis is legacy, and keeps the reason beside it", () => {
    render(<BcaWorkbench {...props} projectPlace={tribalProjectPlace()} />);
    expect(screen.getByText("This analysis has no place.")).toBeVisible();
    expect(screen.queryByText(/legacy/i)).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/cannot yet record .*tribal area/);
  });

  it("still calls an unbound analysis legacy when the project place can be read", () => {
    render(<BcaWorkbench {...props} projectPlace={{ status: "available", snapshot: bcaProjectPlace() }}
      latestSaved={{ status: "found", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: "2026-10-19T00:00:00Z", document: newBcaDocument(bcaProjectId) }} />);
    expect(screen.getByText(/Unbound legacy analysis/)).toBeVisible();
  });

  it("says the same in the method export", async () => {
    const doc = newBcaDocument(bcaProjectId);
    const zip = await JSZip.loadAsync(await exportBcaPackage(doc, {}, bcaPlaceReview(doc, tribalProjectPlace())));
    const memo = await zip.file("method-and-review.md")!.async("string");
    expect(memo).toContain("This analysis has no place.");
    expect(memo).not.toContain("legacy");
  });
});
