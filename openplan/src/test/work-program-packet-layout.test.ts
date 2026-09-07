import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { upgradeWorkProgramDraft } from "@/lib/programs/work-program/draft-recovery";
import type { WorkProgramDraft } from "@/lib/programs/work-program/schema";
import type { WorkProgramRevision } from "@/lib/programs/work-program/types";
import {
  addWorkProgramPacketWorkbook,
  workProgramPacketRows,
  type WorkProgramPacket,
} from "@/lib/programs/work-program/workflow-export";

const draft: WorkProgramDraft = {
  schemaVersion: 1, documentKind: "owp", agency: "Synthetic layout exercise",
  responsibleAuthority: "No actual authority", authorityBasis: "",
  periodStart: "2026-07-01", periodEnd: "2027-06-30", introduction: "",
  staffing: "", financialNotes: "", currency: "USD", priorBalance: null,
  priorBalanceBasis: "", elements: [],
};
const revision: WorkProgramRevision = {
  id: "11111111-1111-4111-8111-111111111111", revision: 2,
  previous_revision_id: null, request_id: "22222222-2222-4222-8222-222222222222",
  content_json: draft, content_sha256: "a".repeat(64), source_ids: [],
  created_by: "33333333-3333-4333-8333-333333333333", created_at: "2026-09-07T00:00:00Z",
};

function packet(note: string): WorkProgramPacket {
  return {
    id: "packet", snapshot_hash: "b".repeat(64), created_at: revision.created_at,
    snapshot: {
      revisionId: revision.id, revisionHash: revision.content_sha256,
      sequence: 1, audience: "internal", baseline: null,
      events: [{
        id: "event", sequence: 1, revision_id: revision.id,
        revision_hash: revision.content_sha256, kind: "approve",
        actor_id: revision.created_by, created_at: revision.created_at, evidence: [],
        payload: {
          requestId: revision.request_id, expectedSequence: 0, expectedRevision: 2,
          revisionId: revision.id, revisionHash: revision.content_sha256,
          kind: "approve", note, visibility: "internal", reviewerIds: [],
          dueOn: null, documentIds: [], evidenceDate: null, authority: "",
          scope: "", targetEventId: null,
        },
      }],
    },
  };
}

describe("work program packet layout", () => {
  it("keeps multiline scope in printable cells without dropping line boundaries", () => {
    const note = Array.from({ length: 90 }, (_, index) => `UNIQUE_LINE_${index} required scope`).join("\n");
    const workbook = addWorkProgramPacketWorkbook(XLSX.utils.book_new(), packet(note), revision);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["Review and amendment record"], { header: 1 });
    const notes = rows.filter(([label]) => label.startsWith("Note")).map(([, value]) => value);
    expect(notes.join("")).toBe(note);
    expect(notes.length).toBeGreaterThan(4);
    expect(notes.every(value => value.split("\n").length <= 13)).toBe(true);
  });

  it("bounds unbroken wide text and keeps every Unicode character intact", () => {
    const note = `${"W".repeat(719)}🚲${"界".repeat(1000)}`;
    const notes = workProgramPacketRows(packet(note), revision)
      .filter(([label]) => label.startsWith("Note")).map(([, value]) => value);
    expect(notes.join("")).toBe(note);
    expect(notes.every(value => Array.from(value).length <= 720)).toBe(true);
    expect(notes.every(value => Buffer.from(value).toString("utf8") === value)).toBe(true);
  });

  it("prefers word boundaries when a review paragraph needs continuation", () => {
    const note = "Review conditions remain unresolved until documented acceptance. ".repeat(40);
    const notes = workProgramPacketRows(packet(note), revision)
      .filter(([label]) => label.startsWith("Note")).map(([, value]) => value);
    expect(notes.join("")).toBe(note);
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.slice(0, -1).every(value => /\s$/.test(value))).toBe(true);
    expect(notes.every(value => Array.from(value).length <= 720)).toBe(true);
  });

  it("moves long amendment identities into bounded detail rows without truncation", () => {
    const before = upgradeWorkProgramDraft(draft);
    const name = "Long funding identity ".repeat(10);
    before.preparation!.funds.push({
      id: revision.id, sourceRefs: [], name, vintage: "2026",
      periodStart: draft.periodStart, periodEnd: draft.periodEnd,
      kind: "proposed", amount: 100, basis: "proposed", note: "",
    });
    const after = structuredClone(before);
    after.preparation!.funds[0].amount = 900;
    const snapshot = packet("");
    snapshot.snapshot.baseline = { ...revision, revision: 1, content_json: before };
    const rows = workProgramPacketRows(snapshot, { ...revision, content_json: after });
    expect(rows.every(([label]) => label.length <= 132)).toBe(true);
    expect(rows.filter(([label]) => label.startsWith("Review detail")).map(([, value]) => value).join(""))
      .toBe(`Changed: Financial preparation / Funding source — ${name} / Amount\nBefore: 100\nAfter: 900`);
  });
});
