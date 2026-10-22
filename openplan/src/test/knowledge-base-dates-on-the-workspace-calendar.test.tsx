import { render } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";
import { kbDocumentDayBounds, resolveKbDocumentListFilters } from "@/lib/knowledge-base/document-list-filters";

/**
 * THE DOCUMENTS LIST AND ITS DATE FILTER READ THE WORKSPACE'S CALENDAR.
 *
 * Servers run in UTC. A document added at 8 p.m. Pacific on October 14 is
 * stored as 03:00 UTC on the 15th. The list printed its UTC day (the 15th) and
 * the "Added between" filter bounded UTC days to match, so a planner who added
 * a file on the evening of the 14th found it under the 15th. Both now use the
 * workspace's zone; the route test (`knowledge-base-documents-route.test.ts`)
 * proves the route reads that zone from the workspace row.
 *
 * BLIND CATEGORY: these tests do not run Postgres. That a TIMESTAMPTZ compared
 * with an ISO instant is an instant comparison is PostgREST's behaviour, not
 * something asserted here.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// 8 p.m. Pacific daylight time on October 14, as Postgres returns it.
const EVENING_PACIFIC_OCT_14 = "2026-10-15T03:00:00+00:00";
// 11:30 p.m. Pacific STANDARD time on November 1, the night daylight time ends.
// A fixed daylight offset would put it at 00:30 on November 2.
const LATE_PACIFIC_NOV_1 = "2026-11-02T07:30:00+00:00";

function doc(over: Partial<KbDocumentRow>): KbDocumentRow {
  return {
    id: "doc-1",
    workspace_id: "ws-1",
    project_id: null,
    title: "2045 RTP",
    doc_kind: "rtp",
    source_kind: "uploaded_pdf",
    original_filename: "rtp.pdf",
    content_type: "application/pdf",
    byte_size: 1_234,
    storage_ref: "storage://kb-documents/ws-1/doc-1/rtp.pdf",
    page_count: 1,
    chunk_count: 1,
    char_count: 100,
    status: "ready",
    extraction_error: null,
    extraction_source: "text_layer",
    citation_label: null,
    created_at: EVENING_PACIFIC_OCT_14,
    updated_at: EVENING_PACIFIC_OCT_14,
    ...over,
  };
}

function stamps(timeZone: string, documents: KbDocumentRow[]): string[] {
  const { container, unmount } = render(
    <KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={documents} timeZone={timeZone} />
  );
  const found = [...container.querySelectorAll(".module-record-stamp")].map((node) => node.textContent ?? "");
  unmount();
  return found;
}

describe("Documents list dates on the workspace calendar", () => {
  it("prints an evening Pacific upload on its Pacific day, not the next UTC day", () => {
    expect(stamps("America/Los_Angeles", [doc({})])).toEqual(["2026-10-14"]);
  });

  it("prints the same upload on a different day for a workspace far from UTC (the zone is the binding)", () => {
    expect(stamps("Asia/Tokyo", [doc({})])).toEqual(["2026-10-15"]);
    expect(stamps("Pacific/Honolulu", [doc({})])).toEqual(["2026-10-14"]);
  });

  it("uses standard time once daylight time ends on November 1", () => {
    expect(stamps("America/Los_Angeles", [doc({ created_at: LATE_PACIFIC_NOV_1 })])).toEqual(["2026-11-01"]);
  });
});

describe("Added between bounds on the workspace calendar", () => {
  it("contains the evening upload in the Pacific 14th and not in the 15th", () => {
    const day14 = kbDocumentDayBounds("2026-10-14", "America/Los_Angeles");
    const day15 = kbDocumentDayBounds("2026-10-15", "America/Los_Angeles");
    expect(day14).toEqual({ from: "2026-10-14T07:00:00.000Z", before: "2026-10-15T07:00:00.000Z" });
    const at = Date.parse(EVENING_PACIFIC_OCT_14);
    expect(at >= Date.parse(day14!.from) && at < Date.parse(day14!.before)).toBe(true);
    expect(at >= Date.parse(day15!.from)).toBe(false);
  });

  it("gives Tokyo and Honolulu their own midnights", () => {
    expect(kbDocumentDayBounds("2026-10-14", "Asia/Tokyo")).toEqual({
      from: "2026-10-13T15:00:00.000Z",
      before: "2026-10-14T15:00:00.000Z",
    });
    expect(kbDocumentDayBounds("2026-10-14", "Pacific/Honolulu")).toEqual({
      from: "2026-10-14T10:00:00.000Z",
      before: "2026-10-15T10:00:00.000Z",
    });
  });

  it("makes November 1 a 25-hour day and March 8 a 23-hour day in Los Angeles", () => {
    expect(kbDocumentDayBounds("2026-11-01", "America/Los_Angeles")).toEqual({
      from: "2026-11-01T07:00:00.000Z",
      before: "2026-11-02T08:00:00.000Z",
    });
    expect(kbDocumentDayBounds("2026-03-08", "America/Los_Angeles")).toEqual({
      from: "2026-03-08T08:00:00.000Z",
      before: "2026-03-09T07:00:00.000Z",
    });
  });

  it("keeps refusing a day that does not exist, in any zone", () => {
    expect(kbDocumentDayBounds("2026-02-31", "America/Los_Angeles")).toBeNull();
    expect(kbDocumentDayBounds("2026-10-14", "Not/AZone")).toBeNull();
  });

  it("resolves the range to an inclusive start and the exclusive start of the day after", () => {
    expect(
      resolveKbDocumentListFilters({ addedFrom: "2026-10-14", addedTo: "2026-10-14", timeZone: "America/Los_Angeles" })
    ).toMatchObject({ addedFrom: "2026-10-14T07:00:00.000Z", addedTo: "2026-10-15T07:00:00.000Z" });
  });
});
