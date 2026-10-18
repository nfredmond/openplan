/**
 * The project page's documents lane (`_components/_documents-lane.ts`).
 *
 * Two contracts under test, both inherited from the inline read the lane
 * replaced and from the Document Library it now fronts:
 *
 * 1. BINDINGS ARE THREADED, NOT RESTATED. Every source read binds the caller's
 *    OWN workspace and project ids. The test varies both bindings across two
 *    calls — one fixture cannot tell "threads the binding" from "hardcodes its
 *    value" (a-wiring-test-must-vary-the-binding).
 * 2. THE HEAD-COUNT IS EXACT AND HONESTLY NULL. `kbCount` comes from the exact
 *    head-count, never from the per-source-capped library listing; any failed
 *    or thrown head read yields null — "0 documents" is a claim a broken query
 *    cannot support.
 */
import { describe, expect, it } from "vitest";

import { loadProjectDocumentsLane } from "@/app/(app)/projects/[projectId]/_components/_documents-lane";
import { DOCUMENT_LIBRARY_SOURCES } from "@/lib/document-library/sources";

type RecordedRead = {
  table: string;
  columns: string;
  head: boolean;
  eqs: Array<[string, string]>;
  limit?: number;
  single?: boolean;
};

type Row = Record<string, unknown>;
type ReadResult = { data: unknown; error: { message: string } | null };

function fakeClient(options?: {
  headCount?: { count: number | null; error: { message: string } | null };
  headThrows?: boolean;
  rowsByTable?: Record<string, Row[]>;
  linkedError?: { message: string };
  linkedThrows?: boolean;
  hiddenDocumentIds?: string[];
}) {
  const reads: RecordedRead[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string, selectOptions?: { head?: boolean }) {
          if (selectOptions?.head) {
            const read: RecordedRead = { table, columns, head: true, eqs: [] };
            reads.push(read);
            return {
              eq(column: string, value: string) {
                read.eqs.push([column, value]);
                if (options?.headThrows) throw new Error("connection reset");
                return Promise.resolve(options?.headCount ?? { count: 0, error: null });
              },
            };
          }
          const read: RecordedRead = { table, columns, head: false, eqs: [] };
          reads.push(read);
          let ordering: { column: string; ascending: boolean } | null = null;
          const rows = () => {
            let result = (options?.rowsByTable?.[table] ?? [])
              .filter((row) => read.eqs.every(([column, value]) => row[column] === value))
              .filter((row) => !options?.hiddenDocumentIds?.includes(String(row.id)));
            if (ordering) {
              const { column, ascending } = ordering;
              result = [...result].sort((a, b) =>
                String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
            }
            if (read.limit !== undefined) result = result.slice(0, read.limit);
            // A dropped projection column must affect the mapped entry.
            return result.map((row) => Object.fromEntries(
              columns.split(",").map((column) => [column.trim(), row[column.trim()]])
            ));
          };
          const chain = {
            eq(column: string, value: string) {
              read.eqs.push([column, value]);
              return chain;
            },
            order(column: string, orderOptions: { ascending: boolean }) {
              ordering = { column, ...orderOptions };
              return chain;
            },
            limit(count: number) {
              read.limit = count;
              return chain;
            },
            async maybeSingle(): Promise<ReadResult> {
              read.single = true;
              if (options?.linkedThrows) throw new Error("connection reset");
              return { data: rows()[0] ?? null, error: options?.linkedError ?? null };
            },
            then(
              resolve: (result: ReadResult) => unknown,
              reject?: (reason: unknown) => unknown
            ) {
              return Promise.resolve({
                data: rows(),
                error: null,
              }).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, reads };
}

describe("loadProjectDocumentsLane", () => {
  it("threads THIS caller's workspace and project into every source read — verified across two bindings", async () => {
    // Two distinct (project, workspace) pairs: a loader that hardcodes either
    // id passes one iteration and fails the other.
    for (const [projectId, workspaceId] of [
      ["p-alpha", "w-alpha"],
      ["p-beta", "w-beta"],
    ] as const) {
      const { client, reads } = fakeClient();
      await loadProjectDocumentsLane(client, projectId, workspaceId);

      const head = reads.find((read) => read.head);
      expect(head?.table).toBe("kb_documents");
      expect(head?.eqs).toEqual([["project_id", projectId]]);

      const libraryReads = reads.filter((read) => !read.head);
      expect(libraryReads.map((read) => read.table).sort()).toEqual(
        DOCUMENT_LIBRARY_SOURCES.map((source) => source.table).sort()
      );
      for (const source of DOCUMENT_LIBRARY_SOURCES) {
        const read = libraryReads.find((r) => r.table === source.table);
        // Workspace filter first, project scope second — through the source's
        // own filter columns (dotted embed paths for the two tables that carry
        // no workspace_id of their own).
        expect(read?.eqs).toEqual([
          [source.workspaceFilterColumn, workspaceId],
          [source.projectFilterColumn, projectId],
        ]);
      }
    }
  });

  it("takes kbCount from the exact head-count, never from the capped library listing", async () => {
    const { client } = fakeClient({
      headCount: { count: 42, error: null },
      rowsByTable: {
        kb_documents: [
          {
            id: "kb-1",
            workspace_id: "w-1",
            project_id: "p-1",
            title: "One of forty-two",
            status: "ready",
            storage_ref: "storage://kb-documents/w/kb-1/f.pdf",
            byte_size: 10,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    });

    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1");

    // 42 documents exist; the capped listing returned 1. The header's claim
    // must be the exact count — a truncated listing cannot support a count.
    expect(lane.kbCount).toBe(42);
    expect(lane.library.perSource.knowledge_base?.count).toBe(1);
  });

  it("answers null — not zero — when the head-count read fails, and still returns the library", async () => {
    const { client } = fakeClient({
      headCount: { count: null, error: { message: "permission denied for table kb_documents" } },
    });

    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1");

    expect(lane.kbCount).toBeNull();
    // One broken read does not empty the shelf: every source still reports.
    expect(Object.keys(lane.library.perSource)).toHaveLength(DOCUMENT_LIBRARY_SOURCES.length);
  });

  it("answers null when the head-count read THROWS — a thrown read is a failed read, not zero", async () => {
    const { client } = fakeClient({ headThrows: true });

    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1");

    expect(lane.kbCount).toBeNull();
  });

  it("does not read a linked source when none is saved", async () => {
    const { client, reads } = fakeClient();
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1");
    expect(lane.estimateSource).toEqual({ status: "unlinked", entry: null });
    expect(reads.some((read) => read.single)).toBe(false);
  });

  it("resolves the exact saved source outside the first 20 without widening the library", async () => {
    for (const [projectId, workspaceId, sourceId] of [
      ["p-alpha", "w-alpha", "older-alpha"],
      ["p-beta", "w-beta", "older-beta"],
    ]) {
      const documents = Array.from({ length: 20 }, (_, index) => ({
        id: `recent-${index}`, workspace_id: workspaceId, project_id: projectId,
        title: `Recent ${index}`, status: "ready", created_at: "2026-10-18",
        storage_ref: `storage://kb-documents/${workspaceId}/recent-${index}/file.csv`,
      }));
      documents.push({
        id: sourceId, workspace_id: workspaceId, project_id: projectId,
        title: "Supporting estimate.csv", status: "ready", created_at: "2026-10-01",
        storage_ref: `storage://kb-documents/${workspaceId}/${sourceId}/estimate.csv`,
      });
      const { client, reads } = fakeClient({ rowsByTable: { kb_documents: documents } });
      const lane = await loadProjectDocumentsLane(client, projectId, workspaceId, sourceId);
      expect(lane.library.limitPerSource).toBe(20);
      expect(lane.library.entries).toHaveLength(20);
      expect(lane.library.entries.some((entry) => entry.id === sourceId)).toBe(false);
      expect(lane.estimateSource).toMatchObject({ status: "readable", entry: {
        id: sourceId, title: "Supporting estimate.csv", projectId, hasBytes: true,
        downloadHref: `/api/knowledge-base/documents/${sourceId}/download`,
      } });
      const exact = reads.filter((read) => read.single);
      expect(exact).toHaveLength(1);
      expect(exact[0]).toEqual({
        table: "kb_documents", head: false, single: true,
        columns: "id, project_id, title, doc_kind, source_kind, byte_size, storage_ref, status, extraction_error, created_at",
        eqs: [["id", sourceId], ["workspace_id", workspaceId], ["project_id", projectId]],
      });
      expect(reads.filter((read) => !read.head && !read.single).every((read) => read.limit === 20)).toBe(true);
      expect(lane.estimateSource.entry).not.toHaveProperty("storage_ref");
    }
  });

  it.each(["workspace_id", "project_id"])("excludes a saved source belonging to another %s", async (column) => {
    const { client } = fakeClient({ rowsByTable: { kb_documents: [
      { id: "saved", workspace_id: "w-1", project_id: "p-1", [column]: "foreign", title: "Private estimate" },
      { id: "different", workspace_id: "w-1", project_id: "p-1", title: "Wrong document" },
    ] } });
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1", "saved");
    expect(lane.estimateSource).toEqual({ status: "unreadable", entry: null });
  });

  it.each([false, true])("keeps missing and RLS-hidden sources indistinguishable (hidden=%s)", async (hidden) => {
    const { client } = fakeClient({
      rowsByTable: { kb_documents: hidden ? [{ id: "saved", workspace_id: "w-1", project_id: "p-1" }] : [] },
      hiddenDocumentIds: hidden ? ["saved"] : [],
    });
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1", "saved");
    expect(lane.estimateSource).toEqual({ status: "unreadable", entry: null });
  });

  it.each([
    ["column storage_ref does not exist", "pending"],
    ["permission denied for table kb_documents", "failed"],
    ["connection reset", "failed"],
  ])("discloses exact-source read error %s as %s", async (message, status) => {
    const { client } = fakeClient({ linkedError: { message } });
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1", "saved");
    expect(lane.estimateSource).toEqual({ status, entry: null });
    expect(lane.library.perSource.knowledge_base).toEqual({ count: 0, pending: false, failed: false });
  });

  it("discloses a thrown source lookup as failed", async () => {
    const { client } = fakeClient({ linkedThrows: true });
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1", "saved");
    expect(lane.estimateSource).toEqual({ status: "failed", entry: null });
  });

  it("retains readable provenance without a download when no original bytes are stored", async () => {
    const { client } = fakeClient({ rowsByTable: { kb_documents: [{
      id: "saved", workspace_id: "w-1", project_id: "p-1", title: "Pasted estimate",
      storage_ref: null, status: "ready",
    }] } });
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1", "saved");
    expect(lane.estimateSource).toMatchObject({ status: "readable", entry: {
      title: "Pasted estimate", hasBytes: false, downloadHref: null,
    } });
  });

  it.each(["stored", "pending", "failed"])("keeps stored bytes openable when indexing status is %s", async (status) => {
    const { client } = fakeClient({ rowsByTable: { kb_documents: [{
      id: "saved", workspace_id: "w-1", project_id: "p-1", title: "Original estimate.csv",
      storage_ref: "storage://kb-documents/w-1/saved/estimate.csv", status,
    }] } });
    const lane = await loadProjectDocumentsLane(client, "p-1", "w-1", "saved");
    expect(lane.estimateSource).toMatchObject({ status: "readable", entry: {
      hasBytes: true, downloadHref: "/api/knowledge-base/documents/saved/download", groundable: false,
    } });
  });
});
