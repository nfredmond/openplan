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

type RecordedRead = { table: string; head: boolean; eqs: Array<[string, string]> };

function fakeClient(options?: {
  headCount?: { count: number | null; error: { message: string } | null };
  headThrows?: boolean;
  rowsByTable?: Record<string, unknown[]>;
}) {
  const reads: RecordedRead[] = [];
  const client = {
    from(table: string) {
      return {
        select(_columns: string, selectOptions?: { head?: boolean }) {
          if (selectOptions?.head) {
            const read: RecordedRead = { table, head: true, eqs: [] };
            reads.push(read);
            return {
              eq(column: string, value: string) {
                read.eqs.push([column, value]);
                if (options?.headThrows) throw new Error("connection reset");
                return Promise.resolve(options?.headCount ?? { count: 0, error: null });
              },
            };
          }
          const read: RecordedRead = { table, head: false, eqs: [] };
          reads.push(read);
          const chain = {
            eq(column: string, value: string) {
              read.eqs.push([column, value]);
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            then(
              resolve: (result: { data: unknown; error: null }) => unknown,
              reject?: (reason: unknown) => unknown
            ) {
              return Promise.resolve({
                data: options?.rowsByTable?.[table] ?? [],
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
});
