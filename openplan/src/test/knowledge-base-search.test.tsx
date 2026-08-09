/**
 * Knowledge Base search — REACHABILITY, end to end, with nothing in the middle
 * stubbed out.
 *
 * The `kb_search_chunks` RPC shipped in July 2026 and until now no UI called
 * it: a workspace could upload its whole corpus and had no way to look inside
 * it. That is the repo's shipped-invisible defect class, so a test that mocked
 * the fetch and asserted the component renders whatever it was handed would
 * prove nothing about the thing that was actually broken — the PATH.
 *
 * So this test wires the real surfaces together: the real client component's
 * `fetch` is answered by the REAL `GET /api/knowledge-base/search` handler,
 * whose only double is the Supabase client (the RPC boundary itself). A break
 * anywhere along component -> URL -> zod -> membership -> RPC name/arguments
 * -> response shape -> render fails this file.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** Every RPC the route issues, recorded at the only boundary this file doubles. */
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcResponse: { data: unknown; error: { message: string } | null } = { data: [], error: null };
let membershipResponse: { data: { role: string } | null; error: { message: string } | null } = {
  data: { role: "owner" },
  error: null,
};
let projectResponse: { data: { id: string } | null; error: { message: string } | null } = {
  data: { id: "proj" },
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === "workspace_members" ? membershipResponse : projectResponse,
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResponse;
    },
  }),
  createServiceRoleClient: () => ({}),
}));

import { GET } from "@/app/api/knowledge-base/search/route";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";
import { retrieveKnowledgeBaseExcerpts } from "@/lib/knowledge-base/retrieval";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const PROJECT_ID = "6f1c9f0c-0f4c-4f2a-9f1e-2b3c4d5e6f70";
const PROJECTS = [{ id: PROJECT_ID, name: "Corridor Rehab", status: "active" }];

/**
 * The component's `fetch`, answered by the real route handler. No response
 * fixture: every field the UI renders has to survive the actual handler.
 */
function routeBackedFetch() {
  return vi.fn(async (url: string) => {
    const response = await GET(new NextRequest(`http://localhost${url}`));
    return response;
  });
}

function doc(over: Partial<KbDocumentRow> = {}): KbDocumentRow {
  return {
    id: "doc-1",
    workspace_id: WORKSPACE_ID,
    project_id: null,
    title: "2045 RTP",
    doc_kind: "rtp",
    source_kind: "uploaded_pdf",
    original_filename: "rtp.pdf",
    content_type: "application/pdf",
    byte_size: 1_234_567,
    storage_ref: "storage://kb-documents/ws/doc-1/rtp.pdf",
    page_count: 12,
    chunk_count: 8,
    char_count: 20_000,
    status: "ready",
    extraction_error: null,
    citation_label: null,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    ...over,
  } as KbDocumentRow;
}

/** A row exactly as `kb_search_chunks` returns it (snake_case, `content` not `snippet`). */
function rpcRow(over: Record<string, unknown> = {}) {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    document_title: "2045 RTP",
    doc_kind: "rtp",
    page_from: 41,
    page_to: 42,
    chunk_index: 3,
    content: "  The complete streets   policy applies to every arterial resurfacing project.  ",
    rank: 0.42,
    ...over,
  };
}

function typeAndSearch(query: string) {
  fireEvent.change(screen.getByLabelText("Search the Knowledge Base"), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: /Search/ }));
}

describe("Knowledge Base search is reachable from the Knowledge Base page", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcResponse = { data: [], error: null };
    membershipResponse = { data: { role: "owner" }, error: null };
    projectResponse = { data: { id: PROJECT_ID }, error: null };
    vi.stubGlobal("fetch", routeBackedFetch());
  });

  it("a planner types a query, the real route runs kb_search_chunks, and the passage renders", async () => {
    rpcResponse = { data: [rpcRow()], error: null };
    render(<KnowledgeBaseWorkspace workspaceId={WORKSPACE_ID} initialDocuments={[doc()]} />);

    typeAndSearch("complete streets policy");

    await waitFor(() =>
      expect(
        screen.getByText(/The complete streets policy applies to every arterial resurfacing/)
      ).toBeInTheDocument()
    );

    // The path: the component called the search route, and the route reached
    // the RPC with the arguments the migration declares.
    const requested = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(requested).toContain("/api/knowledge-base/search?");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("kb_search_chunks");
    expect(rpcCalls[0].args).toEqual({
      p_workspace_id: WORKSPACE_ID,
      p_project_id: null,
      p_query: "complete streets policy",
      p_limit: 10,
    });

    // Provenance a planner needs to cite the hit, carried on the hit itself.
    const hit = screen
      .getByText(/The complete streets policy applies to every arterial resurfacing/)
      .closest("li") as HTMLElement;
    expect(within(hit).getByText("2045 RTP")).toBeInTheDocument();
    expect(within(hit).getByText("pp. 41-42")).toBeInTheDocument();
    expect(within(hit).getByText("Regional Transportation Plan")).toBeInTheDocument();
    expect(screen.getByText(/1 passage matched .*complete streets policy/)).toBeInTheDocument();
  });

  it("scopes the search to the selected project, and says so", async () => {
    rpcResponse = { data: [rpcRow()], error: null };
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[doc()]}
        projects={PROJECTS}
        initialProjectId={PROJECT_ID}
      />
    );

    typeAndSearch("bridge scour");

    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0].args.p_project_id).toBe(PROJECT_ID);
    await waitFor(() =>
      expect(
        screen.getByText(/in Corridor Rehab plus unattached documents/)
      ).toBeInTheDocument()
    );
  });

  it("a FAILED read is never rendered as 'nothing matched'", async () => {
    rpcResponse = { data: null, error: { message: "permission denied for function" } };
    render(<KnowledgeBaseWorkspace workspaceId={WORKSPACE_ID} initialDocuments={[doc()]} />);

    typeAndSearch("complete streets");

    await waitFor(() =>
      expect(screen.getByText(/could not be run, so this screen cannot say/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/No passage in the searched documents matched/)).not.toBeInTheDocument();
    // The operator's raw Postgres message stays in the audit log, not the UI.
    expect(screen.queryByText(/permission denied for function/)).not.toBeInTheDocument();
  });

  it("a SUCCESSFUL search with no hits says so, and discloses what was not indexed", async () => {
    rpcResponse = { data: [], error: null };
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[
          doc(),
          doc({ id: "doc-2", title: "Scanned map", status: "failed", chunk_count: 0 }),
        ]}
      />
    );

    typeAndSearch("bridge scour");

    await waitFor(() =>
      expect(screen.getByText(/No passage in the searched documents matched/)).toBeInTheDocument()
    );
    expect(screen.getByText(/1 of the 2 documents listed below is not indexed yet/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be run/)).not.toBeInTheDocument();
  });

  it("cannot make a claim about a corpus it never read: an unreadable list is not counted", async () => {
    rpcResponse = { data: [], error: null };
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[]}
        readFailures={{ documents: true, projects: false }}
      />
    );

    typeAndSearch("bridge scour");

    await waitFor(() =>
      expect(screen.getByText(/No passage in the searched documents matched/)).toBeInTheDocument()
    );
    expect(
      screen.getByText(/cannot say how many of your documents were searchable/)
    ).toBeInTheDocument();
  });

  /**
   * The caveat was originally shown only when NOTHING matched. But "3 passages
   * matched" is the reading a planner acts on, and it presents a partial corpus
   * as the whole answer — the same defect, hidden behind a result that looks
   * successful. A hit list is only as complete as the corpus behind it.
   */
  it("discloses what was NOT searched even when passages did match", async () => {
    rpcResponse = { data: [rpcRow()], error: null };
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[
          doc(),
          doc({ id: "doc-2", title: "Scanned map", status: "failed", chunk_count: 0 }),
        ]}
      />
    );

    typeAndSearch("complete streets policy");

    await waitFor(() =>
      expect(screen.getByText(/1 passage matched/)).toBeInTheDocument()
    );
    expect(
      screen.getByText(/1 of the 2 documents listed below is not indexed yet/)
    ).toBeInTheDocument();
  });

  it("a hit list does not imply a corpus it could not read", async () => {
    rpcResponse = { data: [rpcRow()], error: null };
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[]}
        readFailures={{ documents: true, projects: false }}
      />
    );

    typeAndSearch("complete streets policy");

    await waitFor(() => expect(screen.getByText(/1 passage matched/)).toBeInTheDocument());
    expect(
      screen.getByText(/cannot say how many of your documents were searchable/)
    ).toBeInTheDocument();
  });

  /**
   * An unreadable project list removed the scope selector with no explanation,
   * so a planner could not tell "this workspace has no projects" from "we could
   * not find out" — and a search they meant to scope ran workspace-wide.
   */
  it("discloses an unreadable project list instead of silently dropping the scope selector", async () => {
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[doc()]}
        projects={[]}
        readFailures={{ documents: false, projects: true }}
      />
    );

    expect(
      screen.getByText(/Your project list could not be read, so the project selector is not shown/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not mean the workspace has no projects/)
    ).toBeInTheDocument();
  });

  it("says nothing about an unreadable project list when the list read fine", async () => {
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[doc()]}
        projects={[]}
        readFailures={{ documents: false, projects: false }}
      />
    );

    expect(screen.queryByText(/Your project list could not be read/)).not.toBeInTheDocument();
  });

  it("refuses a project the workspace does not own instead of answering 'no matches'", async () => {
    projectResponse = { data: null, error: null };
    rpcResponse = { data: [], error: null };
    render(
      <KnowledgeBaseWorkspace
        workspaceId={WORKSPACE_ID}
        initialDocuments={[doc()]}
        projects={PROJECTS}
        initialProjectId={PROJECT_ID}
      />
    );

    typeAndSearch("bridge scour");

    await waitFor(() =>
      expect(screen.getByText(/could not be run, so this screen cannot say/)).toBeInTheDocument()
    );
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("the search route and the best-effort retriever do not drift apart", () => {
  /**
   * Until `retrieval.ts` exposes an outcome-returning core both callers share,
   * two call sites issue the same RPC. This fails the moment they disagree on
   * the function name or its argument names — the way that duplication would
   * actually hurt.
   */
  it("both callers invoke kb_search_chunks with the same argument names", async () => {
    rpcCalls.length = 0;
    rpcResponse = { data: [], error: null };
    membershipResponse = { data: { role: "owner" }, error: null };

    await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/search?workspaceId=${WORKSPACE_ID}&q=policy`
      )
    );

    const retrieverCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    await retrieveKnowledgeBaseExcerpts({
      supabase: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          retrieverCalls.push({ fn, args });
          return { data: [], error: null };
        },
      },
      workspaceId: WORKSPACE_ID,
      query: "policy",
    });

    expect(rpcCalls).toHaveLength(1);
    expect(retrieverCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe(retrieverCalls[0].fn);
    expect(Object.keys(rpcCalls[0].args).sort()).toEqual(Object.keys(retrieverCalls[0].args).sort());
  });
});
