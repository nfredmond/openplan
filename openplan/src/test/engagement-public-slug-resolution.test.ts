import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /engage/{value} resolves a share token OR a printable slug (20260810000002),
 * and the slug path must never widen the public door: it requires
 * `status = 'active'` itself and only ever resolves to a share token that is
 * then loaded through the unchanged token path.
 *
 * THE FAKE APPLIES ITS FILTERS. This loader runs on the service-role client,
 * so the `.eq()` calls are the entire access control — a fake that returns the
 * fixture regardless of filters would stay green with the status filter
 * deleted, which is exactly the mutation this file exists to catch. Filters
 * are ALSO recorded and asserted directly, the convention the public plan page
 * tests established: behaviour proves the gate works, the recorded filter
 * proves it is the gate doing the work.
 */

type Row = Record<string, unknown>;
type RecordedRead = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
};

const readLog: RecordedRead[] = [];
let tableRows: Record<string, Row[]>;

function fakeQuery(record: RecordedRead) {
  const matches = (): Row[] => {
    const rows = tableRows[record.table] ?? [];
    return rows.filter((row) =>
      record.filters.every((filter) => row[filter.column] === filter.value)
    );
  };

  const q: {
    eq: (column: string, value: unknown) => typeof q;
    order: () => typeof q;
    limit: () => typeof q;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise<unknown>;
  } = {
    eq: (column, value) => {
      record.filters.push({ column, value });
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
    then: (resolve) => Promise.resolve({ data: matches(), error: null }).then(resolve),
  };
  return q;
}

const fromMock = vi.fn((table: string) => ({
  select: vi.fn((columns: string) => {
    const record: RecordedRead = { table, columns, filters: [] };
    readLog.push(record);
    return fakeQuery(record);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

import {
  isPublicSlugCandidate,
  loadPublicPortalResultForShareValue,
} from "@/lib/engagement/public-portal-data";
import { PUBLIC_SHARE_TOKEN_LENGTH } from "@/lib/engagement/public-portal";

/** 28 lowercase alphanumerics — the exact shape `mintPublicShareToken` mints. */
const ACTIVE_TOKEN = "a".repeat(PUBLIC_SHARE_TOKEN_LENGTH);
const SLUG = "downtown-corridor-plan";

function campaignRow(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    project_id: null,
    title: "Downtown Corridor Plan",
    summary: null,
    public_description: "Tell us how the corridor should change.",
    status: "active",
    engagement_type: "map_feedback",
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
    updated_at: "2026-08-01T00:00:00.000Z",
    accessibility_contact_label: null,
    accessibility_contact_email: null,
    accessibility_contact_phone: null,
    accessibility_alternate_formats: null,
    share_token: ACTIVE_TOKEN,
    public_slug: SLUG,
    submission_geofence_enabled: false,
    default_content_locale: "en",
    ...overrides,
  };
}

const localeRequest = { acceptLanguage: null };

/** Every read of engagement_campaigns that filtered on the named column. */
function campaignReadsFilteredOn(column: string): RecordedRead[] {
  return readLog.filter(
    (read) =>
      read.table === "engagement_campaigns" &&
      read.filters.some((filter) => filter.column === column)
  );
}

function filterValue(read: RecordedRead | undefined, column: string): unknown {
  return read?.filters.find((filter) => filter.column === column)?.value;
}

beforeEach(() => {
  readLog.length = 0;
  fromMock.mockClear();
  tableRows = {
    engagement_campaigns: [campaignRow()],
    workspaces: [],
    engagement_categories: [],
    engagement_items: [],
    engagement_survey_questions: [],
    engagement_survey_question_options: [],
    engagement_closeloop_entries: [],
    engagement_content_translations: [],
    engagement_context_layers: [],
  };
});

describe("slug shape", () => {
  it("accepts lowercase kebab within the migration's bounds and refuses everything else", () => {
    expect(isPublicSlugCandidate("downtown")).toBe(true);
    expect(isPublicSlugCandidate("downtown-corridor-plan")).toBe(true);
    expect(isPublicSlugCandidate("ab")).toBe(false); // below the 3-char floor
    expect(isPublicSlugCandidate("a".repeat(65))).toBe(false); // above the 64-char cap
    expect(isPublicSlugCandidate("Downtown-Plan")).toBe(false); // uppercase
    expect(isPublicSlugCandidate("-downtown")).toBe(false); // leading hyphen
    expect(isPublicSlugCandidate("downtown-")).toBe(false); // trailing hyphen
    expect(isPublicSlugCandidate("down--town")).toBe(false); // doubled hyphen
    expect(isPublicSlugCandidate("down town")).toBe(false); // whitespace
    expect(isPublicSlugCandidate("plan@example.com")).toBe(false); // not a slug at all
  });
});

describe("public portal resolution by token or slug", () => {
  it("resolves an active campaign by its slug, and the slug read itself requires status = 'active'", async () => {
    const result = await loadPublicPortalResultForShareValue(SLUG, localeRequest);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.bundle.campaign.title).toBe("Downtown Corridor Plan");
    // The bundle is served under the TOKEN — a slug is an address, not a
    // second credential, so fetch URLs and the final load stay token-shaped.
    expect(result.bundle.portalProps.shareToken).toBe(ACTIVE_TOKEN);

    // The filters ARE the access control on a service-role read: the slug
    // lookup must carry status = 'active' itself, not inherit it by luck.
    const slugReads = campaignReadsFilteredOn("public_slug");
    expect(slugReads).toHaveLength(1);
    expect(filterValue(slugReads[0], "public_slug")).toBe(SLUG);
    expect(filterValue(slugReads[0], "status")).toBe("active");
  });

  it("never resolves a non-active campaign by slug — a draft stays invisible at its printable address", async () => {
    tableRows.engagement_campaigns = [campaignRow({ status: "draft" })];

    const result = await loadPublicPortalResultForShareValue(SLUG, localeRequest);

    expect(result.status).toBe("absent");
  });

  it("still resolves a token exactly as before, without ever consulting the slug column", async () => {
    const result = await loadPublicPortalResultForShareValue(ACTIVE_TOKEN, localeRequest);

    expect(result.status).toBe("ok");
    const tokenReads = campaignReadsFilteredOn("share_token");
    expect(tokenReads.length).toBeGreaterThan(0);
    expect(filterValue(tokenReads[0], "share_token")).toBe(ACTIVE_TOKEN);
    expect(filterValue(tokenReads[0], "status")).toBe("active");
    // Token found -> the slug column is never even asked.
    expect(campaignReadsFilteredOn("public_slug")).toHaveLength(0);
  });

  it("disambiguates token-first: a slug that collides with a live token loses to the token", async () => {
    // A second campaign whose SLUG is the first campaign's token — the one
    // collision the overlapping namespaces permit. Token-first lookup means
    // the token's own campaign answers, so a slug can never shadow a token.
    tableRows.engagement_campaigns = [
      campaignRow(),
      campaignRow({
        id: "33333333-3333-4333-8333-333333333333",
        title: "The Impostor",
        share_token: "z".repeat(PUBLIC_SHARE_TOKEN_LENGTH),
        public_slug: ACTIVE_TOKEN,
      }),
    ];

    const result = await loadPublicPortalResultForShareValue(ACTIVE_TOKEN, localeRequest);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.bundle.campaign.title).toBe("Downtown Corridor Plan");
  });

  it("does not query the slug column for a value that could never be a slug", async () => {
    // Invalid even after the lowercasing the resolver applies for hand-typed
    // flyers: '@' and '.' are outside the kebab charset in any case.
    const result = await loadPublicPortalResultForShareValue("plan@example.com", localeRequest);

    expect(result.status).toBe("absent");
    expect(campaignReadsFilteredOn("public_slug")).toHaveLength(0);
  });

  it("resolves a hand-typed slug case-insensitively — a flyer typed back as 'Downtown-Corridor-Plan' still lands", async () => {
    const result = await loadPublicPortalResultForShareValue(
      "Downtown-Corridor-Plan",
      localeRequest
    );

    expect(result.status).toBe("ok");
    const slugReads = campaignReadsFilteredOn("public_slug");
    expect(filterValue(slugReads[0], "public_slug")).toBe(SLUG);
  });

  it("treats a slugged campaign with no share token as absent rather than serving it a token-less portal", async () => {
    tableRows.engagement_campaigns = [campaignRow({ share_token: null })];

    const result = await loadPublicPortalResultForShareValue(SLUG, localeRequest);

    expect(result.status).toBe("absent");
  });
});
