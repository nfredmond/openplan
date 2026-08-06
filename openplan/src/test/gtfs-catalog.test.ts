import { describe, expect, it } from "vitest";

import {
  boundingBoxesIntersect,
  compareByLocality,
  findGtfsFeedsForArea,
  GTFS_CATALOG_MAX_REDIRECT_HOPS,
  loadGtfsCatalog,
  MOBILITY_DATABASE_CATALOG_URL,
  parseGtfsCatalog,
  resolveGtfsCatalogRedirect,
  selectGtfsFeedsForArea,
  type GeoBoundingBox,
  type GtfsCatalogArea,
} from "@/lib/gtfs/catalog";
import { GTFS_MAX_ARCHIVE_BYTES, GTFS_MAX_CATALOG_BYTES } from "@/lib/gtfs/limits";
import type { OutboundDnsLookup } from "@/lib/http/outbound-url";

/**
 * THE FEED CATALOG, DRIVEN WITH REAL CSV AND NO NETWORK.
 *
 * Every fixture below is BUILT — put through the real `parseGtfsCatalog` from
 * real CSV text with the catalog's real 28-column header — rather than described
 * as an object literal. A described fixture proves the assertion; only a built
 * one proves the feature. The header here is verbatim from the live catalog
 * (verified 2026-08-05), so a column renamed in this repo's reader stops
 * matching these rows and the tests say so.
 *
 * The measured facts these cases encode are in `catalog.ts`'s header. The two
 * that carry the most weight:
 *
 *   - only 54 of 1,173 United States static rows say `status = active`, so an
 *     allow-list on `active` would hide 93.5% of usable feeds. "a blank status
 *     is usable" below fails if the deny-list is ever inverted.
 *   - `mdb_source_id` 75, El Dorado Transit — a California operator — publishes
 *     `location.subdivision_name = Colorado`. "the catalog's text location is
 *     never a filter" is that exact row.
 */

/** The live catalog's header, verbatim. Column order is the fixture's contract. */
const CATALOG_COLUMNS = [
  "mdb_source_id",
  "data_type",
  "entity_type",
  "location.country_code",
  "location.subdivision_name",
  "location.municipality",
  "provider",
  "is_official",
  "is_producer_url_unstable",
  "name",
  "note",
  "feed_contact_email",
  "static_reference",
  "urls.direct_download",
  "urls.authentication_type",
  "urls.authentication_info",
  "urls.api_key_parameter_name",
  "urls.latest",
  "urls.license",
  "location.bounding_box.minimum_latitude",
  "location.bounding_box.maximum_latitude",
  "location.bounding_box.minimum_longitude",
  "location.bounding_box.maximum_longitude",
  "location.bounding_box.extracted_on",
  "status",
  "features",
  "redirect.id",
  "redirect.comment",
] as const;

type CatalogCell = Partial<Record<(typeof CATALOG_COLUMNS)[number], string>>;

/** `[minLon, minLat, maxLon, maxLat]`, matching the repo's bbox field order. */
type BboxTuple = [number, number, number, number];

type RowSpec = CatalogCell & {
  id: string;
  bbox?: BboxTuple | null;
};

/**
 * One catalog row. Defaults describe the ORDINARY live row — static GTFS, blank
 * status, open authentication, a populated `urls.latest` — so every test below
 * changes exactly the one thing it is about.
 */
function row(spec: RowSpec): string {
  const { id, bbox, ...overrides } = spec;
  const cells: CatalogCell = {
    mdb_source_id: id,
    data_type: "gtfs",
    entity_type: "",
    "location.country_code": "US",
    provider: `Provider ${id}`,
    name: `Feed ${id}`,
    "urls.direct_download": `https://producer.example.org/${id}/gtfs.zip`,
    "urls.authentication_type": "0",
    "urls.latest": `https://mirror.example.org/${id}.zip`,
    status: "",
    ...overrides,
  };

  if (bbox) {
    cells["location.bounding_box.minimum_longitude"] = String(bbox[0]);
    cells["location.bounding_box.minimum_latitude"] = String(bbox[1]);
    cells["location.bounding_box.maximum_longitude"] = String(bbox[2]);
    cells["location.bounding_box.maximum_latitude"] = String(bbox[3]);
    cells["location.bounding_box.extracted_on"] = "2026-01-15";
  }

  return CATALOG_COLUMNS.map((column) => quote(cells[column] ?? "")).join(",");
}

function quote(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function catalogCsv(...rows: string[]): string {
  return [CATALOG_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

function catalogOf(...rows: string[]) {
  return parseGtfsCatalog(catalogCsv(...rows));
}

/** A one-degree box the searches below use, with nothing real riding on where it is. */
const SEARCH: GtfsCatalogArea = { bbox: { minLon: -121.6, minLat: 38.4, maxLon: -121.4, maxLat: 38.7 } };

/** Inside the search box. */
const LOCAL: BboxTuple = [-121.7, 38.3, -121.3, 38.8];
/** A box that swallows a continent — the Amtrak shape. */
const CONTINENTAL: BboxTuple = [-125, 24, -66, 49];
/** Nowhere near the search box. */
const ELSEWHERE: BboxTuple = [12.3, 45.4, 12.5, 45.6];

function search(catalog: ReturnType<typeof catalogOf>, area: GtfsCatalogArea = SEARCH) {
  return selectGtfsFeedsForArea(catalog, area);
}

function idsFrom(result: ReturnType<typeof search>): string[] {
  return result.feeds.map((feed) => feed.entry.catalogId);
}

/* -------------------------------------------------------------------------- */

describe("the status trap — a deny-list, never an allow-list", () => {
  it("keeps a blank status, which is the majority of the real catalog", () => {
    const result = search(catalogOf(row({ id: "1", bbox: LOCAL, status: "" })));

    expect(idsFrom(result)).toEqual(["1"]);
  });

  /**
   * The 93.5% case, stated as its own test because it is the single most
   * expensive mistake available in this module. An implementation that kept
   * only `active` would pass every other test in this file and hide 775 of the
   * 829 usable United States feeds.
   */
  it("keeps blank, active and development side by side — an allow-list on 'active' would fail here", () => {
    const result = search(
      catalogOf(
        row({ id: "blank", bbox: LOCAL, status: "" }),
        row({ id: "active", bbox: LOCAL, status: "active" }),
        row({ id: "development", bbox: LOCAL, status: "development" }),
      ),
    );

    expect(idsFrom(result).sort()).toEqual(["active", "blank", "development"]);
  });

  it("surfaces the verbatim status so a surface can disclose a development feed", () => {
    const result = search(catalogOf(row({ id: "1", bbox: LOCAL, status: "development" })));

    expect(result.feeds[0].entry.status).toBe("development");
  });

  it("excludes deprecated and inactive, and reports how many it excluded", () => {
    const result = search(
      catalogOf(
        row({ id: "live", bbox: LOCAL }),
        row({ id: "gone", bbox: LOCAL, status: "deprecated" }),
        row({ id: "off", bbox: LOCAL, status: "inactive" }),
        row({ id: "gone-elsewhere", bbox: ELSEWHERE, status: "deprecated" }),
      ),
    );

    expect(idsFrom(result)).toEqual(["live"]);
    expect(result.disclosure.supersededOrInactive).toBe(3);
    // Two of the three claimed a service area covering THIS search — the number
    // that tells a surface to offer redirect resolution rather than report a gap.
    expect(result.disclosure.supersededOrInactiveCoveringArea).toBe(2);
  });

  it("matches the status case-insensitively", () => {
    const result = search(catalogOf(row({ id: "1", bbox: LOCAL, status: "Deprecated" })));

    expect(idsFrom(result)).toEqual([]);
    expect(result.disclosure.supersededOrInactive).toBe(1);
  });
});

describe("authentication — a feed behind a key is refused and named, not hidden", () => {
  it("excludes authentication types 1 and 2 and counts them apart from the superseded", () => {
    const result = search(
      catalogOf(
        row({ id: "open", bbox: LOCAL, "urls.authentication_type": "0" }),
        row({ id: "blank-auth", bbox: LOCAL, "urls.authentication_type": "" }),
        row({
          id: "key-header",
          bbox: LOCAL,
          "urls.authentication_type": "1",
          feed_contact_email: "gtfs@agency.example.org",
        }),
        row({ id: "key-param", bbox: LOCAL, "urls.authentication_type": "2" }),
      ),
    );

    expect(idsFrom(result).sort()).toEqual(["blank-auth", "open"]);
    expect(result.disclosure.requiringApiKey).toBe(2);
    expect(result.disclosure.supersededOrInactive).toBe(0);
  });

  it("names the agency's contact address so a planner can ask for the key", () => {
    const result = search(
      catalogOf(
        row({
          id: "key-header",
          bbox: LOCAL,
          provider: "Somewhere Transit",
          "urls.authentication_type": "1",
          feed_contact_email: "gtfs@agency.example.org",
        }),
      ),
    );

    expect(result.disclosure.requiringApiKeyEntries.map((entry) => entry.feedContactEmail)).toEqual([
      "gtfs@agency.example.org",
    ]);
  });

  it("fails closed on an authentication type it has never seen", () => {
    const result = search(
      catalogOf(row({ id: "odd", bbox: LOCAL, "urls.authentication_type": "kerberos" })),
    );

    expect(idsFrom(result)).toEqual([]);
    expect(result.disclosure.requiringApiKey).toBe(1);
  });
});

describe("what the catalog does not publish is disclosed, never dropped", () => {
  it("counts a feed with no bounding box instead of silently losing it", () => {
    const result = search(
      catalogOf(row({ id: "local", bbox: LOCAL }), row({ id: "no-area", bbox: null })),
    );

    expect(idsFrom(result)).toEqual(["local"]);
    expect(result.disclosure.entriesWithNoPublishedServiceAreaAnywhere).toBe(1);
  });

  it("counts a bounding box that cannot be read as a rectangle", () => {
    const result = search(
      catalogOf(
        // Minimum above maximum: what a feed straddling the antimeridian would
        // have to look like in a min/max schema, and not interpretable.
        row({
          id: "inverted",
          "location.bounding_box.minimum_longitude": "179.5",
          "location.bounding_box.maximum_longitude": "-179.5",
          "location.bounding_box.minimum_latitude": "-18.2",
          "location.bounding_box.maximum_latitude": "-17.6",
        }),
        row({
          id: "impossible-latitude",
          "location.bounding_box.minimum_longitude": "-121.7",
          "location.bounding_box.maximum_longitude": "-121.3",
          "location.bounding_box.minimum_latitude": "38.3",
          "location.bounding_box.maximum_latitude": "938.8",
        }),
      ),
    );

    expect(idsFrom(result)).toEqual([]);
    expect(result.disclosure.entriesWithNoPublishedServiceAreaAnywhere).toBe(2);
  });

  /**
   * The LONGITUDE half of the coordinate-range check, which nothing exercised.
   * The two checks are separate lines reading separate columns, and four of this
   * external schema's column names differ only in the word minimum/maximum or
   * latitude/longitude — the exact place a copy-paste stops being caught.
   */
  it("counts a longitude outside the range a longitude can be in", () => {
    const result = search(
      catalogOf(
        row({
          id: "impossible-longitude",
          "location.bounding_box.minimum_longitude": "-1121.7",
          "location.bounding_box.maximum_longitude": "-121.3",
          "location.bounding_box.minimum_latitude": "38.3",
          "location.bounding_box.maximum_latitude": "38.8",
        }),
      ),
    );

    expect(idsFrom(result)).toEqual([]);
    expect(result.disclosure.entriesWithNoPublishedServiceAreaAnywhere).toBe(1);
  });

  it("counts a covering feed the catalog publishes no download address for", () => {
    const result = search(
      catalogOf(
        row({ id: "no-url", bbox: LOCAL, "urls.latest": "", "urls.direct_download": "" }),
      ),
    );

    expect(idsFrom(result)).toEqual([]);
    expect(result.disclosure.withoutDownloadUrl).toBe(1);
  });

  it("does not disclose feeds that simply serve somewhere else", () => {
    const result = search(
      catalogOf(row({ id: "local", bbox: LOCAL }), row({ id: "far", bbox: ELSEWHERE })),
    );

    expect(idsFrom(result)).toEqual(["local"]);
    expect(result.disclosure.entriesWithNoPublishedServiceAreaAnywhere).toBe(0);
    expect(result.disclosure.withoutDownloadUrl).toBe(0);
  });
});

describe("realtime feeds are not schedules and never appear", () => {
  it("ignores gtfs-rt rows and counts them", () => {
    const catalog = catalogOf(
      row({ id: "static", bbox: LOCAL }),
      row({ id: "vehicles", bbox: LOCAL, data_type: "gtfs-rt" }),
      row({ id: "trip-updates", bbox: LOCAL, data_type: "gtfs-rt" }),
    );

    expect(catalog.entries.map((entry) => entry.catalogId)).toEqual(["static"]);
    expect(catalog.realtimeEntriesIgnored).toBe(2);
    expect(idsFrom(search(catalog))).toEqual(["static"]);
  });
});

describe("the download address", () => {
  it("prefers the catalog's mirror over the producer's own URL", () => {
    const result = search(catalogOf(row({ id: "1", bbox: LOCAL })));

    expect(result.feeds[0].entry.downloadUrl).toBe("https://mirror.example.org/1.zip");
    expect(result.feeds[0].entry.downloadUrlSource).toBe("mirror");
    expect(result.feeds[0].entry.producerUrl).toBe("https://producer.example.org/1/gtfs.zip");
  });

  it("falls back to the producer's URL when the catalog has no mirror", () => {
    const result = search(catalogOf(row({ id: "1", bbox: LOCAL, "urls.latest": "" })));

    expect(result.feeds[0].entry.downloadUrl).toBe("https://producer.example.org/1/gtfs.zip");
    expect(result.feeds[0].entry.downloadUrlSource).toBe("producer");
  });
});

describe("ranking — most local first, and never a selection", () => {
  it("puts the small operator above the continental one, and returns both", () => {
    const result = search(
      catalogOf(
        row({ id: "national", bbox: CONTINENTAL }),
        row({ id: "regional", bbox: [-122.5, 37.5, -120.5, 39.5] }),
        row({ id: "local", bbox: LOCAL }),
      ),
    );

    expect(idsFrom(result)).toEqual(["local", "regional", "national"]);
  });

  it("breaks a tie on distance from the planner's focus", () => {
    // Quarter-degree boxes on quarter-degree boundaries, so both spreads are the
    // same double to the bit and the tie is a real tie rather than an artefact
    // of decimal-to-binary rounding.
    const near: BboxTuple = [-121.75, 38.25, -121.5, 38.5];
    const far: BboxTuple = [-121.5, 38.25, -121.25, 38.5];
    const wide = { minLon: -122, minLat: 38, maxLon: -121, maxLat: 39 };

    const result = search(catalogOf(row({ id: "far", bbox: far }), row({ id: "near", bbox: near })), {
      bbox: wide,
      focus: { lon: -121.625, lat: 38.375 },
    });

    expect(result.feeds[0].serviceAreaSpread).toBe(result.feeds[1].serviceAreaSpread);
    expect(idsFrom(result)).toEqual(["near", "far"]);
  });

  /**
   * THE FALLBACK, WHICH IS THE ORDINARY CASE. A planner who picked a county
   * boundary out of the study-area picker supplies a box and no point, so
   * `focus ?? boundingBoxCentre(bbox)` is the branch almost every real search
   * takes — and every tie-break case here passed an explicit focus, so it was
   * the untested one.
   *
   * The two boxes are quarter-degree boxes on quarter-degree boundaries, so
   * their spreads are the same double to the bit and the ORDER IS DECIDED
   * ENTIRELY BY THE FALLBACK. `west` is nearer the search area's centre; `east`
   * is nearer the origin, and nearer almost any other point a wrong fallback
   * might reach for, so the assertion fails rather than coincidentally holding.
   */
  it("falls back to the centre of the search area when the planner gave no focus", () => {
    const west: BboxTuple = [-121.75, 38.25, -121.5, 38.5];
    const east: BboxTuple = [-121.25, 38.25, -121.0, 38.5];
    const catalog = catalogOf(row({ id: "east", bbox: east }), row({ id: "west", bbox: west }));
    const area: GtfsCatalogArea = { bbox: { minLon: -122, minLat: 38, maxLon: -121, maxLat: 39 } };

    const withoutFocus = search(catalog, area);

    expect(withoutFocus.feeds[0].serviceAreaSpread).toBe(withoutFocus.feeds[1].serviceAreaSpread);
    expect(idsFrom(withoutFocus)).toEqual(["west", "east"]);
    // The offset really was measured from the centre of the box, not from zero
    // and not from the box's corner.
    expect(withoutFocus.feeds[0].focusOffsetDegrees).toBeCloseTo(Math.hypot(0.125, 0.125), 12);

    // And an explicit focus still wins over the fallback: pointing at the east
    // side reverses the order, which a hardcoded centre could not do.
    const withFocus = search(catalog, { ...area, focus: { lon: -121.1, lat: 38.375 } });
    expect(idsFrom(withFocus)).toEqual(["east", "west"]);
  });

  it("orders identical boxes deterministically, so a list does not reshuffle between calls", () => {
    const same: BboxTuple = [-121.6, 38.4, -121.4, 38.6];
    const catalog = catalogOf(
      row({ id: "30", bbox: same }),
      row({ id: "4", bbox: same }),
      row({ id: "100", bbox: same }),
    );

    expect(idsFrom(search(catalog))).toEqual(["4", "30", "100"]);
    expect(idsFrom(search(catalog))).toEqual(idsFrom(search(catalog)));
  });

  it("compares on spread first and offset only as a tie-break", () => {
    const wide = {
      entry: { catalogId: "1" },
      serviceAreaSpread: 10,
      focusOffsetDegrees: 0,
    };
    const tight = {
      entry: { catalogId: "2" },
      serviceAreaSpread: 1,
      focusOffsetDegrees: 9,
    };

    // Typed through the exported comparator's own parameter type, so this stays
    // honest if the ranked shape changes.
    const order = [wide, tight].sort(compareByLocality as (a: typeof wide, b: typeof wide) => number);

    expect(order.map((item) => item.entry.catalogId)).toEqual(["2", "1"]);
  });
});

describe("geography is the bounding box and nothing else", () => {
  it("does not filter on country_code — the catalog covers 84 countries", () => {
    const nairobi: GeoBoundingBox = { minLon: 36.7, minLat: -1.4, maxLon: 37.0, maxLat: -1.1 };
    const result = search(
      catalogOf(
        row({
          id: "ke-1",
          "location.country_code": "KE",
          bbox: [36.6, -1.5, 37.1, -1.0],
        }),
      ),
      { bbox: nairobi },
    );

    expect(idsFrom(result)).toEqual(["ke-1"]);
  });

  /**
   * The verified case. `mdb_source_id` 75 is a California operator whose catalog
   * row says Colorado; its published box contains the search area. If the text
   * fields were ever consulted, this feed would vanish from the list of the very
   * planners who work with it.
   */
  it("returns El Dorado Transit for a California search even though the catalog says Colorado", () => {
    const result = search(
      catalogOf(
        row({
          id: "75",
          provider: "El Dorado Transit",
          "location.subdivision_name": "Colorado",
          "location.municipality": "",
          bbox: [-121.6, 38.4, -120.6, 38.9],
        }),
      ),
    );

    expect(idsFrom(result)).toEqual(["75"]);
    expect(result.feeds[0].entry.statedLocation.subdivisionName).toBe("Colorado");
  });

  it("counts a box that merely touches the search area as covering it", () => {
    const result = search(
      catalogOf(row({ id: "touching", bbox: [-122.6, 38.4, -121.6, 38.7] })),
    );

    expect(idsFrom(result)).toEqual(["touching"]);
  });

  /**
   * The LATITUDE edge of the same rule. The case above touches in longitude
   * only — its latitude range is the search area's, so the latitude comparison
   * is never anywhere near its boundary and either of that line's two operators
   * would satisfy it. This box's northern edge is exactly the search area's
   * southern edge and nothing else overlaps.
   */
  it("counts a box touching only along the latitude edge as covering it", () => {
    const result = search(catalogOf(row({ id: "touching-north", bbox: [-121.6, 38.0, -121.4, 38.4] })));

    expect(idsFrom(result)).toEqual(["touching-north"]);
    // And the same rule at the other end, read directly off the geometry so a
    // caller of the exported predicate gets the same answer the search does.
    expect(
      boundingBoxesIntersect(
        { minLon: -121.6, minLat: 38.7, maxLon: -121.4, maxLat: 39.2 },
        SEARCH.bbox,
      ),
    ).toBe(true);
    // A hair further north and it is genuinely somewhere else.
    expect(
      boundingBoxesIntersect(
        { minLon: -121.6, minLat: 38.71, maxLon: -121.4, maxLat: 39.2 },
        SEARCH.bbox,
      ),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Covered, but withheld                                                       */
/* -------------------------------------------------------------------------- */

const PUBLIC_DNS_FOR_SEARCH: OutboundDnsLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];

/** Run a whole search offline, from CSV text, through the real fetch seam. */
async function searchOverTheWire(csv: string, area: GtfsCatalogArea = SEARCH) {
  return findGtfsFeedsForArea(area, {
    lookup: PUBLIC_DNS_FOR_SEARCH,
    env: {},
    fetchImpl: (async () =>
      new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch,
  });
}

/**
 * THE MISREPORT THIS SPLIT EXISTS TO PREVENT, IN ALL THREE OF ITS FORMS.
 *
 * A feed can cover a planner's study area and still not be offered: the catalog
 * withdrew it, it needs an API key this deployment does not hold, or the catalog
 * publishes no address for it. Each of those is a separate `continue` in
 * `selectGtfsFeedsForArea`, and all three used to fall through to
 * `no_covering_feed` — which states that NOTHING covers the area. A planner in a
 * city with three transit feeds was told their city has none.
 *
 * `no_covering_feed` must therefore be reachable only when every one of the
 * withheld-but-covering lists is empty.
 */
describe("a feed that covers the area is never reported as no transit", () => {
  it("says covered_but_unusable when the only covering feed needs an API key", async () => {
    const outcome = await searchOverTheWire(
      catalogCsv(
        row({
          id: "keyed",
          bbox: LOCAL,
          provider: "Somewhere Transit",
          "urls.authentication_type": "1",
          feed_contact_email: "gtfs@agency.example.org",
        }),
      ),
    );

    expect(outcome.status).toBe("covered_but_unusable");
    if (outcome.status !== "covered_but_unusable") return;
    expect(outcome.withheld).toHaveLength(1);
    expect(outcome.withheld[0].reason).toBe("requires_api_key");
    // Named, not counted — a planner can only act on this if they know who to
    // ask and where to write.
    expect(outcome.withheld[0].entry.provider).toBe("Somewhere Transit");
    expect(outcome.withheld[0].entry.feedContactEmail).toBe("gtfs@agency.example.org");
  });

  it("says covered_but_unusable when the only covering feed was withdrawn, and carries its successor", async () => {
    const outcome = await searchOverTheWire(
      catalogCsv(
        row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "newer" }),
        row({ id: "newer", bbox: ELSEWHERE }),
      ),
    );

    expect(outcome.status).toBe("covered_but_unusable");
    if (outcome.status !== "covered_but_unusable") return;
    expect(outcome.withheld.map((item) => [item.entry.catalogId, item.reason])).toEqual([
      ["old", "superseded"],
    ]);
    // The hook for the recovery path: this id is what a surface hands to
    // `resolveGtfsCatalogRedirect` instead of reporting a gap.
    expect(outcome.withheld[0].entry.redirectToCatalogId).toBe("newer");
  });

  it("says covered_but_unusable when the only covering feed has no published address", async () => {
    const outcome = await searchOverTheWire(
      catalogCsv(
        row({ id: "addressless", bbox: LOCAL, "urls.latest": "", "urls.direct_download": "" }),
      ),
    );

    expect(outcome.status).toBe("covered_but_unusable");
    if (outcome.status !== "covered_but_unusable") return;
    expect(outcome.withheld.map((item) => item.reason)).toEqual(["no_download_url"]);
  });

  it("carries every withheld agency at once, and its list matches the counters beside it", async () => {
    const outcome = await searchOverTheWire(
      catalogCsv(
        row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "newer" }),
        row({ id: "keyed", bbox: LOCAL, "urls.authentication_type": "2" }),
        row({ id: "addressless", bbox: LOCAL, "urls.latest": "", "urls.direct_download": "" }),
        // Withdrawn AND somewhere else: not this planner's problem, and not in
        // the list, or the sentence would name an agency 1,200 km away.
        row({ id: "far-and-old", bbox: ELSEWHERE, status: "inactive" }),
      ),
    );

    expect(outcome.status).toBe("covered_but_unusable");
    if (outcome.status !== "covered_but_unusable") return;
    expect(outcome.withheld.map((item) => [item.entry.catalogId, item.reason])).toEqual([
      ["old", "superseded"],
      ["keyed", "requires_api_key"],
      ["addressless", "no_download_url"],
    ]);
    // The list and the counters are two views of one thing; a counter
    // incremented without its entry pushed would shorten the list silently.
    expect(outcome.withheld).toHaveLength(
      outcome.disclosure.supersededOrInactiveCoveringArea +
        outcome.disclosure.requiringApiKey +
        outcome.disclosure.withoutDownloadUrl,
    );
  });

  it("still says no_covering_feed when the catalog genuinely covers nowhere near the planner", async () => {
    const outcome = await searchOverTheWire(
      catalogCsv(
        row({ id: "far", bbox: ELSEWHERE }),
        // Withheld, but not covering this area either. A withheld feed somewhere
        // else must not turn an honest "nothing here" into a hedge.
        row({ id: "far-keyed", bbox: ELSEWHERE, "urls.authentication_type": "1" }),
        row({ id: "no-area", bbox: null }),
      ),
    );

    expect(outcome.status).toBe("no_covering_feed");
    if (outcome.status !== "no_covering_feed") return;
    expect(outcome.disclosure.entriesWithNoPublishedServiceAreaAnywhere).toBe(1);
  });

  /**
   * The union shape, asserted the same way the `catalog_unavailable` branch is.
   * A surface must not be able to collapse the two answerless branches in either
   * direction — not by reading a `feeds` length, and not by reading a `withheld`
   * length either.
   */
  it("keeps the two answerless branches impossible to collapse into one another", async () => {
    const covered = await searchOverTheWire(
      catalogCsv(row({ id: "keyed", bbox: LOCAL, "urls.authentication_type": "1" })),
    );
    const empty = await searchOverTheWire(catalogCsv(row({ id: "far", bbox: ELSEWHERE })));

    expect("feeds" in covered).toBe(false);
    expect("feeds" in empty).toBe(false);
    expect("withheld" in empty).toBe(false);

    if (covered.status === "covered_but_unusable") {
      // @ts-expect-error - `feeds` must not exist here. If this compiles clean,
      // `outcome.feeds?.length === 0` becomes a way to report a city with three
      // transit feeds as having none.
      void covered.feeds;
    }
    if (empty.status === "no_covering_feed") {
      // @ts-expect-error - and `withheld` must not exist on the honest branch,
      // or the collapse simply runs the other way.
      void empty.withheld;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Redirects                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Redirect resolution over a pre-loaded catalog: the documented no-network seam.
 *
 * The `fetchImpl` that throws is not decoration. Without it, a regression in the
 * preloaded-catalog seam would send every case below to the real Mobility
 * Database over the real network — slowly, and with an answer that depends on
 * what a third party published this morning. A test that can reach the network
 * is a test that can pass for the wrong reason.
 */
function resolve(catalog: ReturnType<typeof catalogOf>, id: string) {
  return resolveGtfsCatalogRedirect(id, {
    catalog,
    fetchImpl: (() => {
      throw new Error("a redirect resolution went to the network despite holding the catalog");
    }) as unknown as typeof fetch,
  });
}

describe("following a saved catalog id to whatever is live today", () => {
  it("answers 'still current' for an id that was never superseded", async () => {
    const outcome = await resolve(catalogOf(row({ id: "1", bbox: LOCAL })), "1");

    expect(outcome.status).toBe("live");
    if (outcome.status !== "live") return;
    expect(outcome.entry.catalogId).toBe("1");
    expect(outcome.supersededIds).toEqual([]);
  });

  it("walks a chain to the live successor and records what it passed", async () => {
    const outcome = await resolve(
      catalogOf(
        row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "newer" }),
        row({ id: "newer", bbox: LOCAL, status: "deprecated", "redirect.id": "newest" }),
        row({ id: "newest", bbox: LOCAL }),
      ),
      "old",
    );

    expect(outcome.status).toBe("live");
    if (outcome.status !== "live") return;
    expect(outcome.entry.catalogId).toBe("newest");
    expect(outcome.supersededIds).toEqual(["old", "newer"]);
  });

  it("refuses a cycle instead of walking it", async () => {
    const outcome = await resolve(
      catalogOf(
        row({ id: "a", bbox: LOCAL, status: "deprecated", "redirect.id": "b" }),
        row({ id: "b", bbox: LOCAL, status: "deprecated", "redirect.id": "a" }),
      ),
      "a",
    );

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("redirect_cycle");
    expect(outcome).toHaveProperty("code", "catalog_entry_deprecated");
  });

  it("refuses a chain longer than the hop bound, and does not call it a cycle", async () => {
    const links = Array.from({ length: GTFS_CATALOG_MAX_REDIRECT_HOPS + 3 }, (_, index) =>
      row({
        id: `hop-${index}`,
        bbox: LOCAL,
        status: "deprecated",
        "redirect.id": `hop-${index + 1}`,
      }),
    );
    const outcome = await resolve(
      catalogOf(...links, row({ id: `hop-${links.length}`, bbox: LOCAL })),
      "hop-0",
    );

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("chain_too_long");
  });

  /**
   * THE BOUND IS THE NUMBER OF FOLLOWS, AND THE REFUSAL SAYS SO.
   *
   * The walk read `hop <= MAX`, which is nine follows for a bound of eight,
   * while `chain_too_long` told whoever read it that eight had been tried. Both
   * halves are asserted here because either alone can be satisfied by the wrong
   * fix: a chain of exactly `MAX` follows must ARRIVE, one longer must be
   * REFUSED, and the sentence must name the number that was applied.
   */
  it("follows exactly as many hops as it says it does", async () => {
    /** `length` redirects from `hop-0`, ending on a live `hop-{length}`. */
    const chainOf = (length: number) =>
      catalogOf(
        ...Array.from({ length }, (_, index) =>
          row({
            id: `hop-${index}`,
            bbox: LOCAL,
            status: "deprecated",
            "redirect.id": `hop-${index + 1}`,
          }),
        ),
        row({ id: `hop-${length}`, bbox: LOCAL }),
      );

    const atTheBound = await resolve(chainOf(GTFS_CATALOG_MAX_REDIRECT_HOPS), "hop-0");
    expect(atTheBound.status).toBe("live");
    if (atTheBound.status === "live") {
      expect(atTheBound.entry.catalogId).toBe(`hop-${GTFS_CATALOG_MAX_REDIRECT_HOPS}`);
      expect(atTheBound.supersededIds).toHaveLength(GTFS_CATALOG_MAX_REDIRECT_HOPS);
    }

    const oneBeyond = await resolve(chainOf(GTFS_CATALOG_MAX_REDIRECT_HOPS + 1), "hop-0");
    expect(oneBeyond.status).toBe("refused");
    if (oneBeyond.status !== "refused") return;
    expect(oneBeyond.reason).toBe("chain_too_long");
    // The sentence names the limit that was actually applied. A refusal stating
    // eight while enforcing nine sends whoever reads it looking for an entry the
    // message says cannot exist.
    expect(oneBeyond.detail).toContain(String(GTFS_CATALOG_MAX_REDIRECT_HOPS));
    expect(oneBeyond.supersededIds).toHaveLength(GTFS_CATALOG_MAX_REDIRECT_HOPS);
  });

  it("refuses a dead pointer — 41 of the 244 real US redirects are one", async () => {
    const outcome = await resolve(
      catalogOf(row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "vanished" })),
      "old",
    );

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("dead_pointer");
    expect(outcome.detail).toContain("vanished");
  });

  it("refuses a successor that is itself withdrawn with nowhere further to go", async () => {
    const outcome = await resolve(
      catalogOf(
        row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "also-old" }),
        row({ id: "also-old", bbox: LOCAL, status: "inactive" }),
      ),
      "old",
    );

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("still_superseded");
  });

  it("refuses a successor that needs a key, and says who to ask", async () => {
    const outcome = await resolve(
      catalogOf(
        row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "keyed" }),
        row({
          id: "keyed",
          bbox: LOCAL,
          provider: "Somewhere Transit",
          "urls.authentication_type": "1",
          feed_contact_email: "gtfs@agency.example.org",
        }),
      ),
      "old",
    );

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("requires_api_key");
    expect(outcome).toHaveProperty("code", "catalog_entry_requires_key");
    expect(outcome.detail).toContain("gtfs@agency.example.org");
  });

  /**
   * The last member of the closed refusal vocabulary, which had no case. A
   * vocabulary is only closed if every word in it is reachable — an unreachable
   * one is either dead or a bug nobody has hit yet, and nothing said which.
   */
  it("refuses a successor the catalog publishes no download address for", async () => {
    const outcome = await resolve(
      catalogOf(
        row({ id: "old", bbox: LOCAL, status: "deprecated", "redirect.id": "addressless" }),
        row({ id: "addressless", bbox: LOCAL, "urls.latest": "", "urls.direct_download": "" }),
      ),
      "old",
    );

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("no_download_url");
    expect(outcome).toHaveProperty("code", "catalog_entry_deprecated");
    expect(outcome.supersededIds).toEqual(["old"]);
  });

  /**
   * An id the catalog never heard of is a fact about a REQUEST, not about a
   * feed. Giving it a feed status would write "this feed is deprecated" into a
   * status column about a feed that does not exist.
   */
  it("refuses an unknown id WITHOUT a feed failure code", async () => {
    const outcome = await resolve(catalogOf(row({ id: "1", bbox: LOCAL })), "999");

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toBe("unknown_id");
    expect("code" in outcome).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Reaching the catalog over the wire                                          */
/* -------------------------------------------------------------------------- */

const PUBLIC_DNS: OutboundDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function servingCsv(csv: string): typeof fetch {
  return (async () =>
    new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch;
}

const REFUSING_FETCH: typeof fetch = (async () => {
  throw new TypeError("fetch failed");
}) as typeof fetch;

const wireOptions = {
  lookup: PUBLIC_DNS,
  env: {} as Record<string, string | undefined>,
};

describe("a catalog that could not be read is never an answer about transit", () => {
  it("reports catalog_unavailable, with no feeds field to mistake for an empty result", async () => {
    const outcome = await findGtfsFeedsForArea(SEARCH, {
      ...wireOptions,
      fetchImpl: REFUSING_FETCH,
    });

    expect(outcome.status).toBe("catalog_unavailable");
    // THE MISREPORT THIS WHOLE UNION EXISTS TO PREVENT. A caller that wrote
    // `outcome.feeds.length === 0 ? "no transit here" : …` against a
    // flag-shaped result would say "no transit" here; there is nothing to read.
    expect("feeds" in outcome).toBe(false);
    expect("disclosure" in outcome).toBe(false);
    if (outcome.status !== "catalog_unavailable") return;
    expect(outcome.code).toBe("catalog_unavailable");

    // @ts-expect-error - `feeds` must not exist on the unavailable branch. If
    // this line ever compiles clean, the union has been flattened and the
    // misreport above is representable again.
    void outcome.feeds;
  });

  it("is a different status from an area the catalog answered nothing for", async () => {
    const outcome = await findGtfsFeedsForArea(SEARCH, {
      ...wireOptions,
      fetchImpl: servingCsv(catalogCsv(row({ id: "far", bbox: ELSEWHERE }))),
    });

    expect(outcome.status).toBe("no_covering_feed");
    expect("feeds" in outcome).toBe(false);
    if (outcome.status !== "no_covering_feed") return;
    // The answer still discloses what was considered — an empty list with no
    // context is not something a planner can act on.
    expect(outcome.disclosure.staticEntriesConsidered).toBe(1);
  });

  it("treats a download that is not the catalog as unavailable, not as an empty world", async () => {
    const outcome = await findGtfsFeedsForArea(SEARCH, {
      ...wireOptions,
      fetchImpl: servingCsv("<!doctype html>\n<title>404</title>\n"),
    });

    expect(outcome.status).toBe("catalog_unavailable");
  });

  it("refuses a catalog address that resolves inside the deployment's own network", async () => {
    const outcome = await findGtfsFeedsForArea(SEARCH, {
      ...wireOptions,
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      fetchImpl: servingCsv(catalogCsv(row({ id: "1", bbox: LOCAL }))),
    });

    expect(outcome.status).toBe("catalog_unavailable");
    if (outcome.status !== "catalog_unavailable") return;
    // THE ADDRESS DOES NOT REACH THE PLANNER'S SENTENCE. See the fetch lane's
    // `redactResolvedAddresses`: a refusal that echoes the deployment's resolver
    // answer is a DNS-mapping oracle wearing an error message.
    expect(outcome.detail).not.toContain("169.254.169.254");
    // It is still knowable, on the side, for whoever operates the deployment.
    expect(outcome.diagnostic).toContain("169.254.169.254");
    // And the refusal still says what happened, or nobody can act on it.
    expect(outcome.detail).toContain("own network");
    expect(outcome.detail).toContain("storage.googleapis.com");
  });

  /**
   * THE SEAM THAT WALKED PAST THE GUARD.
   *
   * `loadGtfsCatalog` refuses a catalog with no entries, because zero static
   * feeds means what arrived was not the catalog. That check used to sit after
   * the download — so `options.catalog`, which this module DOCUMENTS as the
   * supported way to reuse a catalog across calls, returned before reaching it.
   * A caller handing in an empty catalog got `no_covering_feed`: "your area has
   * no transit", from a value that says nothing about any area.
   */
  it("refuses an empty catalog handed in by a caller, not only one it downloaded", async () => {
    const outcome = await findGtfsFeedsForArea(SEARCH, {
      catalog: parseGtfsCatalog(catalogCsv()),
      fetchImpl: (() => {
        throw new Error("the catalog was re-fetched despite being passed in");
      }) as unknown as typeof fetch,
    });

    expect(outcome.status).toBe("catalog_unavailable");
    expect("disclosure" in outcome).toBe(false);
  });

  it("refuses an empty catalog through loadGtfsCatalog itself, on both paths", async () => {
    const injected = await loadGtfsCatalog({ catalog: parseGtfsCatalog(catalogCsv()) });
    const downloaded = await loadGtfsCatalog({
      ...wireOptions,
      fetchImpl: servingCsv(catalogCsv()),
    });

    expect(injected.ok).toBe(false);
    expect(downloaded.ok).toBe(false);
    if (injected.ok || downloaded.ok) return;
    expect(injected.code).toBe("catalog_unavailable");
    // ONE BRANCH, SO THE TWO PATHS CANNOT DRIFT. The wording is deliberately
    // free of "downloaded": on the injected path nothing was, and a refusal
    // describing a download that never happened sends the reader to check a
    // network they never touched.
    expect(injected.detail).toBe(downloaded.detail);
    expect(injected.detail).not.toMatch(/download/i);
  });

  it("reports the same unknown when a redirect resolution cannot read the catalog", async () => {
    const outcome = await resolveGtfsCatalogRedirect("75", {
      ...wireOptions,
      fetchImpl: REFUSING_FETCH,
    });

    expect(outcome.status).toBe("catalog_unavailable");
  });
});

describe("reading the catalog over the wire", () => {
  it("fetches the pinned address and ranks what it finds", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(catalogCsv(row({ id: "national", bbox: CONTINENTAL }), row({ id: "local", bbox: LOCAL })), {
        status: 200,
      });
    }) as typeof fetch;

    const outcome = await findGtfsFeedsForArea(SEARCH, { ...wireOptions, fetchImpl });

    expect(requested).toEqual([MOBILITY_DATABASE_CATALOG_URL]);
    expect(outcome.status).toBe("matched");
    if (outcome.status !== "matched") return;
    expect(outcome.feeds.map((feed) => feed.entry.catalogId)).toEqual(["local", "national"]);
    expect(outcome.catalogUrl).toBe(MOBILITY_DATABASE_CATALOG_URL);
  });

  /**
   * THE PIN IS THE WHOLE STRING, because the argument the constant's own comment
   * makes is a supply-chain argument: a third party who can change where every
   * deployment looks for its feed catalog can hand every deployment a CSV of
   * their choosing, and the first thing any deployment does with the result is
   * fetch the URLs in it.
   *
   * A prefix assertion does not make that argument. `storage.googleapis.com` is
   * a bucket host anyone on earth can put an object in, so a match on the host
   * leaves the BUCKET and the OBJECT — the two parts that decide whose file this
   * is — pinned by nothing. Changing where this deployment looks must be a
   * visible edit that fails a test, which is the only form of "pinned" that
   * survives a model handoff.
   */
  it("is pinned to one address in full, not merely to a host", () => {
    expect(MOBILITY_DATABASE_CATALOG_URL).toBe(
      "https://storage.googleapis.com/storage/v1/b/mdb-csv/o/sources.csv?alt=media",
    );
  });

  it("does not go anywhere near a shortlink", () => {
    expect(MOBILITY_DATABASE_CATALOG_URL).toMatch(/^https:\/\/storage\.googleapis\.com\//);
    expect(MOBILITY_DATABASE_CATALOG_URL).not.toContain("bit.ly");
  });

  it("lets an operator point at their own mirror of the catalog", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(catalogCsv(row({ id: "1", bbox: LOCAL })), { status: 200 });
    }) as typeof fetch;

    const loaded = await loadGtfsCatalog({
      ...wireOptions,
      fetchImpl,
      catalogUrl: "https://mirror.example.org/sources.csv",
    });

    expect(loaded.ok).toBe(true);
    expect(requested).toEqual(["https://mirror.example.org/sources.csv"]);
  });

  /**
   * THE CATALOG HAS A BOUND OF ITS OWN, AND IT IS NOT THE ARCHIVE'S.
   *
   * The fetch used to borrow `GTFS_MAX_ARCHIVE_BYTES` (192 MiB) on the argument
   * that a fetched artifact is a fetched artifact. What that missed is what
   * happens next: the bytes are decoded to one string and handed to a
   * SYNCHRONOUS CSV parse at roughly 14x expansion, so a catalog anywhere near
   * the archive bound is a multi-gigabyte allocation inside one call — a fatal
   * V8 out-of-memory, which the `try` around the parse cannot catch and no
   * `catalog_unavailable` refusal survives.
   *
   * TWO VALUES, ONE TEST, on purpose. A single configured cap cannot tell a
   * binding from a literal: replacing `limits.maxCatalogBytes` with whatever
   * number the test happened to set would pass. Nothing hardcoded satisfies a
   * body that is refused at one cap and accepted at the other.
   */
  it("bounds the catalog download by its own limit, at two different values", async () => {
    const csv = catalogCsv(row({ id: "1", bbox: LOCAL }));
    const load = (bytes: number) =>
      loadGtfsCatalog({
        ...wireOptions,
        env: { [GTFS_MAX_CATALOG_BYTES.env]: String(bytes) },
        fetchImpl: servingCsv(csv),
      });

    const tooSmall = await load(csv.length - 1);
    const justEnough = await load(csv.length);

    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) {
      expect(tooSmall.code).toBe("catalog_unavailable");
      // The size the deployment applied reaches the sentence, so an operator
      // knows which number to raise.
      expect(tooSmall.detail).toContain((csv.length - 1).toLocaleString("en-US"));
    }
    expect(justEnough.ok).toBe(true);

    // And it really is a SEPARATE bound: raising the archive cap does not raise
    // this one, which is the whole point of splitting them.
    const archiveCannotSave = await loadGtfsCatalog({
      ...wireOptions,
      env: {
        [GTFS_MAX_CATALOG_BYTES.env]: String(csv.length - 1),
        [GTFS_MAX_ARCHIVE_BYTES.env]: String(csv.length * 1000),
      },
      fetchImpl: servingCsv(csv),
    });
    expect(archiveCannotSave.ok).toBe(false);

    // The default is far below the archive bound, where the synchronous parse
    // is affordable, and far above the 1.15 MB artifact it actually reads.
    expect(GTFS_MAX_CATALOG_BYTES.defaultValue).toBeLessThan(GTFS_MAX_ARCHIVE_BYTES.defaultValue);
    expect(GTFS_MAX_CATALOG_BYTES.defaultValue).toBeGreaterThan(1_154_557);
  });

  it("fetches nothing at all when the caller already holds the catalog", async () => {
    const loaded = await loadGtfsCatalog({
      catalog: catalogOf(row({ id: "1", bbox: LOCAL })),
      fetchImpl: (() => {
        throw new Error("the catalog was re-fetched despite being passed in");
      }) as unknown as typeof fetch,
    });

    expect(loaded.ok).toBe(true);
  });
});

describe("reading the CSV itself", () => {
  /**
   * EVERY COLUMN NAME PINNED AT ONCE, by asserting one fully-populated entry
   * whole rather than field by field.
   *
   * `COLUMN` in `catalog.ts` is an EXTERNAL SCHEMA — 22 names published by
   * somebody else, four of which differ only in the word minimum/maximum or
   * latitude/longitude. Before this case, 8 of the 22 were pinned by nothing:
   * renaming `location.municipality` or `urls.authentication_info` in the
   * reader left every test green and the field silently null on a real row.
   * `toEqual` over the whole projection fails the moment any one of them stops
   * matching the live header at the top of this file.
   *
   * It is also the only place that states what the projection IS — which
   * 22 columns are carried and which of the catalog's 28 are deliberately not.
   */
  it("projects one fully-populated row into exactly the entry it claims to", () => {
    const catalog = catalogOf(
      row({
        id: "512",
        data_type: "gtfs",
        "location.country_code": "US",
        "location.subdivision_name": "California",
        "location.municipality": "Grass Valley",
        provider: "Somewhere Transit",
        name: "Somewhere Transit Fixed Route",
        feed_contact_email: "gtfs@agency.example.org",
        "urls.direct_download": "https://producer.example.org/512/gtfs.zip",
        "urls.authentication_type": "2",
        "urls.authentication_info": "https://agency.example.org/developers",
        "urls.api_key_parameter_name": "api_key",
        "urls.latest": "https://mirror.example.org/512.zip",
        "urls.license": "https://agency.example.org/license",
        "location.bounding_box.minimum_longitude": "-121.7",
        "location.bounding_box.minimum_latitude": "38.3",
        "location.bounding_box.maximum_longitude": "-121.3",
        "location.bounding_box.maximum_latitude": "38.8",
        "location.bounding_box.extracted_on": "2026-01-15",
        status: "development",
        "redirect.id": "900",
        "redirect.comment": "merged into the regional feed",
      }),
    );

    expect(catalog.entries[0]).toEqual({
      catalogId: "512",
      provider: "Somewhere Transit",
      name: "Somewhere Transit Fixed Route",
      status: "development",
      statedLocation: {
        countryCode: "US",
        subdivisionName: "California",
        municipality: "Grass Valley",
      },
      boundingBox: { minLon: -121.7, minLat: 38.3, maxLon: -121.3, maxLat: 38.8 },
      boundingBoxExtractedOn: "2026-01-15",
      downloadUrl: "https://mirror.example.org/512.zip",
      downloadUrlSource: "mirror",
      mirrorUrl: "https://mirror.example.org/512.zip",
      producerUrl: "https://producer.example.org/512/gtfs.zip",
      licenseUrl: "https://agency.example.org/license",
      authentication: {
        type: "2",
        requiresKey: true,
        apiKeyParameterName: "api_key",
        info: "https://agency.example.org/developers",
      },
      feedContactEmail: "gtfs@agency.example.org",
      redirectToCatalogId: "900",
      redirectComment: "merged into the regional feed",
    });
  });

  it("reads a data_type the catalog wrote in capitals", () => {
    // The reader lowercases before comparing, and nothing tested that it does.
    // A catalog that starts publishing `GTFS` would otherwise move every static
    // feed on earth into the ignored pile, and the result would read to every
    // planner as "nowhere has transit".
    const catalog = catalogOf(
      row({ id: "shouty", bbox: LOCAL, data_type: "GTFS" }),
      row({ id: "realtime", bbox: LOCAL, data_type: "GTFS-RT" }),
    );

    expect(catalog.entries.map((entry) => entry.catalogId)).toEqual(["shouty"]);
    expect(catalog.realtimeEntriesIgnored).toBe(1);
    expect(catalog.unrecognisedDataTypeRows).toBe(0);
  });

  /**
   * A COUNT'S NAME IS A CLAIM. `realtimeEntriesIgnored` used to be
   * everything-that-is-not-`gtfs`, so a blank cell or a `gtfs-flex` row was
   * counted under it and disclosed to a planner as a realtime feed — a fact the
   * code never established about a row it never looked at. What the parse
   * actually knows is that it did not recognise the type, and that is a
   * different admission: it is the one that should make somebody look.
   */
  it("does not call an unrecognised data_type a realtime feed", () => {
    const catalog = catalogOf(
      row({ id: "static", bbox: LOCAL }),
      row({ id: "realtime", bbox: LOCAL, data_type: "gtfs-rt" }),
      row({ id: "flex", bbox: LOCAL, data_type: "gtfs-flex" }),
      row({ id: "blank", bbox: LOCAL, data_type: "" }),
    );

    expect(catalog.entries.map((entry) => entry.catalogId)).toEqual(["static"]);
    expect(catalog.realtimeEntriesIgnored).toBe(1);
    expect(catalog.unrecognisedDataTypeRows).toBe(2);
  });

  it("keeps the last of two rows sharing an id, and counts the collision", () => {
    const catalog = catalogOf(
      row({ id: "1", bbox: LOCAL, provider: "First" }),
      row({ id: "1", bbox: LOCAL, provider: "Second" }),
    );

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0].provider).toBe("Second");
    expect(catalog.duplicateIds).toBe(1);
  });

  it("counts a row with no id rather than inventing one", () => {
    const catalog = catalogOf(row({ id: "", bbox: LOCAL }), row({ id: "1", bbox: LOCAL }));

    expect(catalog.entries.map((entry) => entry.catalogId)).toEqual(["1"]);
    expect(catalog.unreadableRows).toBe(1);
  });

  it("survives a row whose field count disagrees with the header", () => {
    const csv = catalogCsv(row({ id: "1", bbox: LOCAL })) + "2,gtfs,truncated\n";
    const catalog = parseGtfsCatalog(csv);

    expect(catalog.entries.map((entry) => entry.catalogId)).toEqual(["1", "2"]);
    expect(catalog.entries[1].boundingBox).toBeNull();
  });

  it("reads a header carrying a UTF-8 byte order mark", () => {
    const catalog = parseGtfsCatalog("﻿" + catalogCsv(row({ id: "1", bbox: LOCAL })));

    expect(catalog.entries.map((entry) => entry.catalogId)).toEqual(["1"]);
  });

  it("reads a quoted field containing a comma", () => {
    const catalog = catalogOf(row({ id: "1", bbox: LOCAL, provider: "Somewhere Transit, Inc." }));

    expect(catalog.entries[0].provider).toBe("Somewhere Transit, Inc.");
  });
});

/**
 * WHAT THE PARSE COUNTED HAS TO REACH THE ANSWER, or it is a number nobody can
 * read. A count that lives only inside the parse is exactly as useful as a count
 * that lives in a log — which is to say not at all, because the planner drawing
 * a conclusion about their area never sees it.
 *
 * `duplicateIds` is the one that mattered most and was dropped entirely: two
 * rows sharing an `mdb_source_id` are not two copies of one feed (measured on
 * the live catalog they differ in provider and download URL), so last-wins
 * REMOVES A REAL AGENCY from the list a planner is reading, and no number
 * downstream could say so.
 */
describe("every number the parse counted survives into the disclosure", () => {
  it("carries the parse's counts through the search rather than dropping them", () => {
    const catalog = catalogOf(
      row({ id: "local", bbox: LOCAL }),
      row({ id: "realtime", bbox: LOCAL, data_type: "gtfs-rt" }),
      row({ id: "flex", bbox: LOCAL, data_type: "gtfs-flex" }),
      row({ id: "", bbox: LOCAL }),
      row({ id: "twin", bbox: LOCAL, provider: "First" }),
      row({ id: "twin", bbox: LOCAL, provider: "Second" }),
    );

    const { disclosure } = search(catalog);

    expect(disclosure.realtimeEntriesIgnored).toBe(catalog.realtimeEntriesIgnored);
    expect(disclosure.unrecognisedDataTypeRows).toBe(catalog.unrecognisedDataTypeRows);
    expect(disclosure.unreadableRows).toBe(catalog.unreadableRows);
    expect(disclosure.duplicateIds).toBe(catalog.duplicateIds);

    // And the values are the real ones, not four zeroes agreeing with each
    // other — a carry-through test over an all-zero fixture proves nothing.
    expect(disclosure.realtimeEntriesIgnored).toBe(1);
    expect(disclosure.unrecognisedDataTypeRows).toBe(1);
    expect(disclosure.unreadableRows).toBe(1);
    expect(disclosure.duplicateIds).toBe(1);
    expect(disclosure.staticEntriesConsidered).toBe(2);
  });
});
