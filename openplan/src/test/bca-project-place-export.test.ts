import { expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { bcaHtml, bcaMemo, exportBcaPackage } from "@/lib/bca/workbench/export";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaPlaceReview } from "@/lib/bca/workbench/project-place";
import { calculateBcaDocument } from "@/lib/bca/workbench/engine";
import { bcaProjectId, bcaProjectPlace } from "./fixtures/bca/project-place";

it("exports retained and current scopes separately in JSON, memo, HTML and workbook", async () => {
  const legacy = exampleBcaDocument(bcaProjectId);
  const doc = reviewBcaProjectPlace(legacy, bcaProjectPlace());
  const current = { ...bcaProjectPlace(), projectUpdatedAt: "2026-10-19T01:02:03.123457+00:00" };
  const review = bcaPlaceReview(doc, { status: "available", snapshot: current });
  const before = JSON.stringify(doc);
  const zip = await JSZip.loadAsync(await exportBcaPackage(doc, {}, review));
  expect(JSON.parse(await zip.file("analysis.json")!.async("string"))).toEqual(doc);
  expect(JSON.parse(await zip.file("project-place.json")!.async("string"))).toEqual(review);
  expect(JSON.parse(await zip.file("manifest.json")!.async("string")).projectPlaceStatus).toBe("changed-since-review");
  for (const name of ["report.html", "method-and-review.md"]) {
    const text = await zip.file(name)!.async("string");
    expect(text).toContain("changed-since-review");
    expect(text).toContain(legacy.geography);
    expect(text).toContain(bcaProjectPlace().projectUpdatedAt);
    expect(text).toContain(current.projectUpdatedAt);
    expect(text).toContain("does not establish jurisdiction");
    expect(text).toContain("concurrent project change");
  }
  const workbook = XLSX.read(await zip.file("calculation.xlsx")!.async("uint8array"), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Project place"], { header: 1 });
  expect(JSON.stringify(rows)).toContain("changed-since-review");
  expect(JSON.stringify(rows)).toContain(legacy.geography);
  expect(calculateBcaDocument(doc)).toEqual(calculateBcaDocument(legacy));
  expect(JSON.stringify(doc)).toBe(before);
  expect(await zip.file("SHA256SUMS.txt")!.async("string")).toContain("  project-place.json\n");
});

it("keeps legacy exports unbound and does not invent a live read for standalone retained exports", async () => {
  const legacy = exampleBcaDocument(bcaProjectId);
  const review = bcaPlaceReview(legacy, { status: "available", snapshot: bcaProjectPlace() });
  const zip = await JSZip.loadAsync(await exportBcaPackage(legacy, {}, review));
  expect(JSON.parse(await zip.file("analysis.json")!.async("string"))).toEqual(legacy);
  expect(JSON.parse(await zip.file("project-place.json")!.async("string"))).toMatchObject({ status: "unbound", retained: null });
  expect(await zip.file("method-and-review.md")!.async("string")).toContain("Unbound legacy analysis");
  const doc = reviewBcaProjectPlace(legacy, bcaProjectPlace());
  expect(bcaMemo(doc)).toContain("current-unavailable");
  expect(bcaMemo(doc)).toContain("No live project read");
  expect(bcaHtml({ ...doc, geography: "<script>synthetic</script>" })).not.toContain("<script>");
});
