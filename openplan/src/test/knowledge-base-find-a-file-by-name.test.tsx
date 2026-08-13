import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";
import {
  buildKbDocumentNameFilter,
  describeKbDocumentListResult,
  kbDocumentDayBounds,
  KB_DOCUMENT_LIST_LIMIT,
  resolveKbDocumentListFilters,
  resolveKbDocumentOrder,
  sanitizeKbDocumentNameTerm,
} from "@/lib/knowledge-base/document-list-filters";

/**
 * A PLANNER WHO REMEMBERS THE FILENAME MUST BE ABLE TO FIND THE FILE.
 *
 * The Documents page had exactly one text input and it searched INSIDE
 * documents — the wrong door for "where did I put the scour report". Worse, the
 * list is capped, so in a workspace holding more than the cap the file may never
 * have been on the page to scroll to.
 *
 * The load-bearing property these tests protect is that the name filter travels
 * to the SERVER. A filter applied to the rows already in the browser would pass
 * every rendering assertion below while leaving the capped-out documents exactly
 * as unfindable as before — so the request itself is asserted, not just the
 * result.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function doc(over: Partial<KbDocumentRow> = {}): KbDocumentRow {
  return {
    id: "doc-1",
    workspace_id: "ws-1",
    project_id: null,
    title: "2045 RTP",
    doc_kind: "rtp",
    source_kind: "uploaded_pdf",
    original_filename: "rtp.pdf",
    content_type: "application/pdf",
    byte_size: 1_234_567,
    storage_ref: "storage://kb-documents/ws-1/doc-1/rtp.pdf",
    page_count: 12,
    chunk_count: 8,
    char_count: 20_000,
    status: "ready",
    extraction_error: null,
    extraction_source: "text_layer",
    citation_label: null,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

describe("finding a Knowledge Base file by its name", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks the SERVER for the match — not the rows already loaded", async () => {
    const found = doc({ id: "doc-201", title: "Bridge scour report", original_filename: "scour.pdf" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [found],
        appliedFilters: { nameTerm: "scour", sort: "newest", addedFrom: null, addedTo: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // The one document the browser holds is NOT the one being looked for: a
    // client-side filter over these rows could only ever return nothing.
    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);

    fireEvent.change(screen.getByLabelText("Find documents by name or filename"), {
      target: { value: "scour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.getByText("Bridge scour report")).toBeInTheDocument());

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://example.test");
    expect(requested.pathname).toBe("/api/knowledge-base/documents");
    expect(requested.searchParams.get("q")).toBe("scour");
    expect(requested.searchParams.get("workspaceId")).toBe("ws-1");
  });

  it("sends the whole filename, punctuation and all, when a planner pastes one", async () => {
    // The most natural thing to type into a box labelled "name or filename".
    const filename = "2023_Corridor_Study_FINAL_v3.pdf";
    const found = doc({ id: "doc-77", title: "Corridor study", original_filename: filename });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [found],
        appliedFilters: { nameTerm: filename, sort: "newest", addedFrom: null, addedTo: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    fireEvent.change(screen.getByLabelText("Find documents by name or filename"), {
      target: { value: filename },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://example.test");
    // Dots and underscores intact: the previous sanitizer sent
    // "2023 Corridor Study FINAL v3 pdf", which matches this document nowhere.
    expect(requested.searchParams.get("q")).toBe(filename);
  });

  it("sends the chosen order to the server rather than reordering what is loaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [doc()],
        appliedFilters: { nameTerm: null, sort: "title", addedFrom: null, addedTo: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    fireEvent.change(screen.getByLabelText("Order the document list"), {
      target: { value: "title" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://example.test");
    expect(requested.searchParams.get("sort")).toBe("title");
  });

  it("sends the date range as calendar days the server can bound", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [],
        appliedFilters: {
          nameTerm: null,
          sort: "newest",
          addedFrom: "2026-01-01T00:00:00.000Z",
          addedTo: "2026-06-30T23:59:59.999Z",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    fireEvent.change(screen.getByLabelText("Added on or after"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Added on or before"), {
      target: { value: "2026-06-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://example.test");
    expect(requested.searchParams.get("addedFrom")).toBe("2026-01-01");
    expect(requested.searchParams.get("addedTo")).toBe("2026-06-30");

    // An empty FILTERED list is a statement about the filters, never about the
    // corpus — the invitation to re-upload must not appear.
    await waitFor(() =>
      expect(screen.getByText(/No documents match these filters/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/No documents yet/)).not.toBeInTheDocument();
  });

  it("says the cap bound instead of presenting a full page as the whole corpus", async () => {
    const page = Array.from({ length: KB_DOCUMENT_LIST_LIMIT }, (_, index) =>
      doc({ id: `doc-${index}`, title: `Document ${index}` })
    );
    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={page} />);

    const caption = screen.getByTestId("kb-list-caption").textContent ?? "";
    expect(caption).toMatch(new RegExp(`Showing the first ${KB_DOCUMENT_LIST_LIMIT} documents`));
    expect(caption).toMatch(/there are more/);
    // The old sentence claimed a total. It must not survive anywhere on screen.
    expect(caption).not.toMatch(
      new RegExp(`^${KB_DOCUMENT_LIST_LIMIT} documents in this workspace\\.$`)
    );
  });

  it("does not restate the corpus count when the list is a filtered subset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [doc()],
        appliedFilters: { nameTerm: "rtp", sort: "newest", addedFrom: null, addedTo: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    expect(screen.getByTestId("kb-list-caption").textContent).toBe("1 document in this workspace.");

    fireEvent.change(screen.getByLabelText("Find documents by name or filename"), {
      target: { value: "rtp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByTestId("kb-list-caption").textContent).toBe(
        "1 document in this workspace matches these filters."
      )
    );
  });

  it("believes the server's echo, not the date in the box", async () => {
    // The planner's date is perfectly well-formed; the ECHO says the read did
    // not narrow by it. Without this the screen would show an unnarrowed list
    // under a narrowed-looking form — every row present, and the planner
    // believing they are looking at one month.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [doc()],
        appliedFilters: { nameTerm: null, sort: "newest", addedFrom: null, addedTo: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    fireEvent.change(screen.getByLabelText("Added on or after"), {
      target: { value: "2026-02-28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByText(/not a date this screen could use/)).toBeInTheDocument()
    );
  });
});

describe("the filter helpers the list read is built from", () => {
  /**
   * THE TEST THIS REPLACES ASSERTED THE BUG. It required
   * `sanitizeKbDocumentNameTerm("rtp,title.ilike.%")` to come back as
   * `"rtp title ilike"` — dots and underscores flattened to spaces — which is
   * the same rule that turned `2023_Corridor_Study_FINAL_v3.pdf` into a term
   * matching neither the title nor the filename it names. The box is labelled
   * "Find documents by name or filename"; the one thing it could not do was
   * find a file by its filename. The term is now kept and escaped where it
   * becomes a filter instead.
   */
  it("keeps the characters filenames are made of", () => {
    const filename = "2023_Corridor_Study_FINAL_v3.pdf";
    expect(sanitizeKbDocumentNameTerm(filename)).toBe(filename);
    expect(sanitizeKbDocumentNameTerm("Draft RTP (2045) — final.docx")).toBe(
      "Draft RTP (2045) — final.docx"
    );
    expect(sanitizeKbDocumentNameTerm("   ")).toBeNull();
    // `*` is the one printable character still dropped: PostgREST rewrites it
    // to `%` inside an ilike value before any escaping can reach it.
    expect(sanitizeKbDocumentNameTerm("***")).toBeNull();
  });

  /**
   * The escaping, verified live against the local PostgREST on 2026-08-12 —
   * every expectation below was observed as an HTTP response, not derived from
   * the docs. Two layers escape differently: PostgREST's quoted-string parser
   * turns `\X` into `X`, and SQL LIKE reads `\_` as a literal underscore, so a
   * literal `_` has to leave here as `\\_`.
   */
  it("quotes and escapes the term so the filter searches for it rather than parsing it", () => {
    expect(buildKbDocumentNameFilter("scour")).toBe(
      'title.ilike."%scour%",original_filename.ilike."%scour%"'
    );

    // Underscores and percent signs are LIKE wildcards. Unescaped,
    // `2023_Corridor` would also match `2023xCorridor`; escaped, it does not.
    expect(buildKbDocumentNameFilter("2023_Corridor_Study_FINAL_v3.pdf")).toBe(
      'title.ilike."%2023\\\\_Corridor\\\\_Study\\\\_FINAL\\\\_v3.pdf%",' +
        'original_filename.ilike."%2023\\\\_Corridor\\\\_Study\\\\_FINAL\\\\_v3.pdf%"'
    );
    expect(buildKbDocumentNameFilter("50% design")).toContain('"%50\\\\% design%"');

    // The quotes are what make a comma or a parenthesis text rather than
    // grammar. Unquoted, `(` silently matched NOTHING at all (HTTP 200, zero
    // rows) and `,` opened a second clause.
    expect(buildKbDocumentNameFilter("Commission (demo), 2045")).toBe(
      'title.ilike."%Commission (demo), 2045%",original_filename.ilike."%Commission (demo), 2045%"'
    );

    // And the quote itself is escaped, or the term breaks out of the value and
    // appends a filter of its own — observed live before the escape was added.
    expect(buildKbDocumentNameFilter('zzz",id.eq.11111111')).toBe(
      'title.ilike."%zzz\\",id.eq.11111111%",original_filename.ilike."%zzz\\",id.eq.11111111%"'
    );
  });

  it("bounds a calendar day in UTC — the same clock the list prints dates in", () => {
    expect(kbDocumentDayBounds("2026-06-30")).toEqual({
      from: "2026-06-30T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
    });
    // A day that does not exist must not silently roll into the next month.
    expect(kbDocumentDayBounds("2026-02-31")).toBeNull();
    expect(kbDocumentDayBounds("June 30")).toBeNull();
  });

  it("resolves each order to a column and a direction", () => {
    expect(resolveKbDocumentOrder("newest")).toEqual({ column: "created_at", ascending: false });
    expect(resolveKbDocumentOrder("oldest")).toEqual({ column: "created_at", ascending: true });
    expect(resolveKbDocumentOrder("title")).toEqual({ column: "title", ascending: true });
    // An unknown order falls back to newest rather than to whatever the
    // database happens to return.
    expect(resolveKbDocumentListFilters({ sort: "sideways" }).sort).toBe("newest");
  });

  it("never calls a capped page a total, and never calls a filtered count a corpus", () => {
    const unfiltered = resolveKbDocumentListFilters({});
    expect(
      describeKbDocumentListResult({ count: 3, filters: unfiltered, scopeLabel: null })
    ).toBe("3 documents in this workspace.");
    expect(
      describeKbDocumentListResult({
        count: KB_DOCUMENT_LIST_LIMIT,
        filters: unfiltered,
        scopeLabel: null,
      })
    ).toMatch(/Showing the first 200 documents in this workspace — there are more/);
    expect(
      describeKbDocumentListResult({
        count: 3,
        filters: resolveKbDocumentListFilters({ q: "scour" }),
        scopeLabel: "Corridor Rehab",
      })
    ).toBe("3 documents linked to Corridor Rehab match these filters.");
  });
});
