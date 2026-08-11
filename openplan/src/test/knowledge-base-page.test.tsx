import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * /knowledge-base PAGE WIRING — the seam the component tests cannot see.
 *
 * The workspace component renders whatever `library` prop it is handed, so its
 * tests pass with a described fixture whether or not the page ever loads the
 * lane. This is the shipped-invisible defect class: a complete, tested Document
 * Library that no planner can reach because the page forgot to pass it. These
 * tests call the real server component and inspect the element it returns.
 *
 * The binding that matters most: `loadDocumentLibrary` must receive the SAME
 * client the page created for the signed-in caller — the RLS client. Two of
 * the library's sources have no workspace_id column of their own; a
 * service-role client here would be a cross-tenant leak.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn(() => {
  throw new Error("the knowledge-base page must never create a service-role client");
});
const loadDocumentLibraryMock = vi.fn();
const loadMembershipMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadMembershipMock(...args),
}));

vi.mock("@/lib/document-library/query", () => ({
  loadDocumentLibrary: (...args: unknown[]) => loadDocumentLibraryMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

import KnowledgeBasePage from "@/app/(app)/knowledge-base/page";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

/** A thenable query chain answering whatever rows the table fake holds. */
function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => ({
      select: () => {
        if (table === "projects") {
          return chain({
            data: [{ id: PROJECT_ID, name: "Corridor Rehab", status: "active" }],
            error: null,
          });
        }
        if (table === "kb_documents") return chain({ data: [], error: null });
        throw new Error(`Unexpected table: ${table}`);
      },
    }),
  };
}

function libraryResult() {
  return {
    entries: [],
    reads: new ReadFailureLog(),
    perSource: { knowledge_base: { count: 0, pending: false, failed: false } },
    limitPerSource: 20,
  };
}

describe("/knowledge-base page wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue(fakeSupabase());
    loadMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
    });
    loadDocumentLibraryMock.mockResolvedValue(libraryResult());
  });

  it("loads the Document Library with the caller's RLS client and hands it to the workspace", async () => {
    const rlsClient = fakeSupabase();
    createClientMock.mockResolvedValue(rlsClient);

    const element = await KnowledgeBasePage({ searchParams: Promise.resolve({}) });

    // The lane was read with the SAME client the page created for the caller —
    // never a second (service-role) one.
    expect(loadDocumentLibraryMock).toHaveBeenCalledTimes(1);
    const [clientArg, optionsArg] = loadDocumentLibraryMock.mock.calls[0];
    expect(clientArg).toBe(rlsClient);
    expect(optionsArg).toMatchObject({ workspaceId: WORKSPACE_ID, projectId: null });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();

    // …and the result reaches the component, labels included.
    expect(element.type).toBe(KnowledgeBaseWorkspace);
    const props = element.props as Record<string, unknown>;
    const library = props.library as {
      perSource: Record<string, unknown>;
      limitPerSource: number;
      sourceLabels: Record<string, string>;
      readFailureSummary: string | null;
    };
    expect(library.limitPerSource).toBe(20);
    expect(library.perSource.knowledge_base).toEqual({ count: 0, pending: false, failed: false });
    expect(library.sourceLabels.report_artifacts).toBe("Reports");
    expect(library.readFailureSummary).toBeNull();
    // The operator's upload ceiling reaches the pre-flight check too.
    expect(props.maxUploadBytes).toBeGreaterThan(0);
  });

  it("scopes the library lane to a validated ?projectId= deep link", async () => {
    await KnowledgeBasePage({
      searchParams: Promise.resolve({ projectId: PROJECT_ID }),
    });
    expect(loadDocumentLibraryMock.mock.calls[0][1]).toMatchObject({ projectId: PROJECT_ID });
  });

  it("passes the failed-read sentence through instead of dropping it", async () => {
    const reads = new ReadFailureLog();
    reads.check("report files", { error: { message: "permission denied" } });
    loadDocumentLibraryMock.mockResolvedValue({ ...libraryResult(), reads });

    const element = await KnowledgeBasePage({ searchParams: Promise.resolve({}) });
    const library = (element.props as Record<string, unknown>).library as {
      readFailureSummary: string | null;
    };
    expect(library.readFailureSummary).toMatch(/could not read report files/);
  });
});
