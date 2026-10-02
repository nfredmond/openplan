import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A CLOSED CAMPAIGN STILL ANSWERS AT ITS PRINTED ADDRESS, read-only.
 *
 * A resident who opens a postcard link after the comment period ends used to
 * get the generic not-found page. The link now answers with a notice that the
 * comment period has ended, and with nothing from the campaign: staff close a
 * campaign to take it offline, and a campaign can be closed without ever
 * having been public.
 *
 * THE FAKE APPLIES ITS FILTERS, for the reason
 * `engagement-public-slug-resolution.test.ts` gives: this loader runs on the
 * service-role client, so the `.eq()` calls are the whole access control. A
 * fake that ignored them would stay green with the status filter deleted. The
 * draft and archived cases below are the ones that fail if the closed read
 * ever stops naming `closed`.
 */

type Row = Record<string, unknown>;
type RecordedRead = { table: string; columns: string; filters: Array<{ column: string; value: unknown }> };

const readLog: RecordedRead[] = [];
const rpcLog: string[] = [];
let tableRows: Record<string, Row[]>;
let closeLoopEntries: Row[];

function fakeQuery(record: RecordedRead) {
  // The approved-comment read pages by a keyset cursor and stops only on an
  // empty page, so the fake has to honour the cursor or the read never ends.
  let cursor: { createdAt: string; id: string } | null = null;
  const matches = (): Row[] =>
    (tableRows[record.table] ?? [])
      .filter((row) => record.filters.every((filter) => row[filter.column] === filter.value))
      .filter(
        (row) =>
          !cursor ||
          String(row.created_at) < cursor.createdAt ||
          (String(row.created_at) === cursor.createdAt && String(row.id) > cursor.id)
      );

  const q: {
    eq: (column: string, value: unknown) => typeof q;
    order: () => typeof q;
    or: (value: string) => typeof q;
    limit: () => typeof q;
    range: () => typeof q;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise<unknown>;
  } = {
    eq: (column, value) => {
      record.filters.push({ column, value });
      return q;
    },
    order: () => q,
    or: (value) => {
      const parsed = value.match(/^created_at\.lt\.(.*),and\(created_at\.eq\.(.*),id\.gt\.(.*)\)$/);
      if (!parsed) throw new Error(`Unexpected cursor filter: ${value}`);
      cursor = { createdAt: parsed[1], id: parsed[3] };
      return q;
    },
    limit: () => q,
    range: () => q,
    maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
    then: (resolve) => Promise.resolve({ data: matches(), error: null }).then(resolve),
  };
  return q;
}

const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        const record: RecordedRead = { table, columns, filters: [] };
        readLog.push(record);
        return fakeQuery(record);
      },
    }),
    rpc: async (name: string, args: { p_campaign: string; p_published_only: boolean }) => {
      rpcLog.push(name);
      return {
        data: {
          campaignId: args.p_campaign,
          publishedOnly: args.p_published_only,
          count: closeLoopEntries.length,
          entries: closeLoopEntries,
        },
        error: null,
      };
    },
  }),
}));

import PublicEngagementMapPage, {
  generateMetadata as mapPageMetadata,
} from "@/app/(portal)/engage/[shareToken]/page";
import PublicEngagementAboutPage, {
  generateMetadata as aboutPageMetadata,
} from "@/app/(portal)/engage/[shareToken]/about/page";
import {
  loadPublicPortalBundle,
  loadPublicPortalResultForShareValue,
} from "@/lib/engagement/public-portal-data";
import { PUBLIC_SHARE_TOKEN_LENGTH } from "@/lib/engagement/public-portal";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "c".repeat(PUBLIC_SHARE_TOKEN_LENGTH);
const SLUG = "elm-street-plan";

function campaignRow(status: string): Row {
  return {
    id: CAMPAIGN_ID,
    workspace_id: "22222222-2222-4222-8222-222222222222",
    project_id: null,
    title: "Elm Street safety plan",
    summary: "Internal note for staff.",
    public_description: "Tell us where Elm Street feels unsafe.",
    status,
    engagement_type: "map_feedback",
    configuration_version_id: null,
    participation_starts_at: null,
    participation_ends_at: null,
    // Left open on purpose: the closed page must refuse submissions because of
    // the campaign status, not because this flag happened to be off.
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
    updated_at: "2026-08-01T00:00:00.000Z",
    accessibility_contact_label: null,
    accessibility_contact_email: null,
    accessibility_contact_phone: null,
    accessibility_alternate_formats: null,
    share_token: TOKEN,
    public_slug: SLUG,
    submission_geofence_enabled: false,
    default_content_locale: "en",
  };
}

function itemRow(overrides: Row): Row {
  return {
    campaign_id: CAMPAIGN_ID,
    configuration_version_id: null,
    category_id: null,
    title: null,
    submitted_by: null,
    latitude: null,
    longitude: null,
    geometry: null,
    photo_path: null,
    votes_count: 0,
    parent_item_id: null,
    created_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function seed(status: string) {
  tableRows = {
    engagement_campaigns: [campaignRow(status)],
    engagement_public_items: [
      itemRow({
        id: "item-approved",
        status: "approved",
        body: "The crossing at 5th needs a signal.",
        submitted_by: "Dolores Whitfield",
        photo_path: "photos/item-approved.jpg",
      }),
      itemRow({ id: "item-pending", status: "pending", body: "This one was never approved." }),
    ],
  };
  closeLoopEntries = [
    {
      id: "entry-1",
      campaign_id: CAMPAIGN_ID,
      category_id: null,
      theme_title: "Crossings",
      you_said: "People asked for a signal at 5th.",
      we_did: "The signal is in the 2027 budget.",
      status: "published",
      ai_assisted: false,
      source_item_ids: [],
      sort_order: 0,
      published_at: "2026-08-01T00:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ];
}

const pageArgs = (value: string, lang?: string) => ({
  params: Promise.resolve({ shareToken: value }),
  searchParams: Promise.resolve(lang ? { lang } : {}),
});

beforeEach(() => {
  readLog.length = 0;
  rpcLog.length = 0;
  notFoundMock.mockClear();
  seed("closed");
});

/** Everything the campaign holds that a closed page must not show. */
const CAMPAIGN_CONTENT = [
  "Elm Street safety plan",
  "Tell us where Elm Street feels unsafe.",
  "Internal note for staff.",
  "The crossing at 5th needs a signal.",
  "Dolores Whitfield",
  "This one was never approved.",
  "Crossings",
  "People asked for a signal at 5th.",
  "The signal is in the 2027 budget.",
];

function expectNoticeOnly(container: HTMLElement) {
  const notice = screen.getByTestId("closed-campaign-notice");
  expect(notice.getAttribute("role")).toBe("status");

  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(notice.contains(headings[0])).toBe(true);

  for (const text of CAMPAIGN_CONTENT) {
    expect(container.textContent).not.toContain(text);
  }

  // Nothing to submit with, and nothing to press. The language picker is made
  // of links.
  for (const selector of ["form", "textarea", "input", "select", "button", "img", "canvas"]) {
    expect(container.querySelector(selector), selector).toBeNull();
  }
  const links = Array.from(container.querySelectorAll("a"));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.getAttribute("href")).toMatch(/[?&]lang=/);
  }
}

/** The closed path may read the campaign row to check its status, and nothing else. */
function expectNoContentReads() {
  expect(rpcLog).toEqual([]);
  expect(readLog.length).toBeGreaterThan(0);
  for (const read of readLog) {
    expect(read.table).toBe("engagement_campaigns");
    const named = read.filters.find((filter) => filter.column === "status")?.value;
    // The active attempt asks for the full row and matches nothing. Any read
    // that can match a closed campaign asks only for what the gate needs.
    if (named !== "active") {
      expect(named).toBe("closed");
      expect(["id, status", "share_token"]).toContain(read.columns.trim());
    }
  }
}

describe("a closed campaign's public page", () => {
  it("says the comment period has ended and shows nothing from the campaign", async () => {
    const { container } = render(await PublicEngagementMapPage(pageArgs(TOKEN, "en")));

    const notice = screen.getByTestId("closed-campaign-notice");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This comment period has ended.");
    expect(notice.textContent).toContain("Comments are no longer being accepted.");
    expect(notice.textContent).toContain("contact the city, county or agency that sent you this link");

    expectNoticeOnly(container);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("never asks the database for comments, responses or any other campaign content", async () => {
    render(await PublicEngagementMapPage(pageArgs(TOKEN, "en")));

    expectNoContentReads();
  });

  it("renders the same notice-only page at /about", async () => {
    const { container } = render(await PublicEngagementAboutPage(pageArgs(TOKEN, "en")));

    expectNoticeOnly(container);
    expectNoContentReads();
  });

  it("says it in Spanish when the resident asks for Spanish", async () => {
    const { container } = render(await PublicEngagementMapPage(pageArgs(TOKEN, "es")));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Este período de comentarios ha terminado."
    );
    expect(screen.getByTestId("closed-campaign-notice").textContent).toContain("Ya no se aceptan comentarios.");
    expectNoticeOnly(container);
  });

  it("answers at the printed slug with the same notice and no content", async () => {
    const { container } = render(await PublicEngagementMapPage(pageArgs(SLUG, "en")));

    expectNoticeOnly(container);
    expectNoContentReads();
  });

  it("keeps the campaign's title and description out of the tab title and link preview", async () => {
    for (const metadataFor of [mapPageMetadata, aboutPageMetadata]) {
      const metadata = await metadataFor(pageArgs(TOKEN, "en"));

      expect(metadata.title).toBe("This comment period has ended.");
      const serialized = JSON.stringify(metadata);
      for (const text of CAMPAIGN_CONTENT) expect(serialized).not.toContain(text);
    }
  });

  it("reports closed as its own result, carrying the language and no campaign data", async () => {
    const result = await loadPublicPortalResultForShareValue(TOKEN, { acceptLanguage: null });

    expect(result.status).toBe("closed");
    expect(Object.keys(result).sort()).toEqual(["locale", "messages", "status"]);
    const serialized = JSON.stringify(result);
    for (const text of CAMPAIGN_CONTENT) expect(serialized).not.toContain(text);
    expect(serialized).not.toContain(CAMPAIGN_ID);
    expectNoContentReads();
  });

  it("stays not found for callers that only understand an active campaign", async () => {
    // The embed and every other caller of this wrapper.
    await expect(loadPublicPortalBundle(TOKEN, { acceptLanguage: null })).resolves.toBeNull();
  });

  it("still serves the full page for an active campaign, so the notice is not the only thing this file can see", async () => {
    seed("active");

    const result = await loadPublicPortalResultForShareValue(TOKEN, { acceptLanguage: null });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.bundle.campaign.title).toBe("Elm Street safety plan");
    expect(result.bundle.portalProps.approvedItems.map((item) => item.id)).toEqual(["item-approved"]);
    expect(rpcLog).toEqual(["read_engagement_response_snapshot"]);
  });
});

describe("campaigns that must stay not found", () => {
  it.each(["draft", "archived"])("a %s campaign is not found by token or by slug", async (status) => {
    seed(status);

    await expect(PublicEngagementMapPage(pageArgs(TOKEN, "en"))).rejects.toThrow("notFound");
    await expect(PublicEngagementAboutPage(pageArgs(TOKEN, "en"))).rejects.toThrow("notFound");
    await expect(PublicEngagementMapPage(pageArgs(SLUG, "en"))).rejects.toThrow("notFound");

    expect(
      (await loadPublicPortalResultForShareValue(TOKEN, { acceptLanguage: null })).status
    ).toBe("absent");
    expect(
      (await loadPublicPortalResultForShareValue(SLUG, { acceptLanguage: null })).status
    ).toBe("absent");

    // Every campaign read that could open a page named a status, and none
    // named this one.
    const gatingReads = readLog.filter(
      (read) =>
        read.table === "engagement_campaigns" &&
        read.filters.some((filter) => filter.column === "share_token" || filter.column === "public_slug")
    );
    expect(gatingReads.length).toBeGreaterThan(0);
    for (const read of gatingReads) {
      const named = read.filters.find((filter) => filter.column === "status")?.value;
      expect(["active", "closed"]).toContain(named);
    }
  });

  it("an unknown token is not found", async () => {
    await expect(
      PublicEngagementMapPage(pageArgs("z".repeat(PUBLIC_SHARE_TOKEN_LENGTH), "en"))
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
