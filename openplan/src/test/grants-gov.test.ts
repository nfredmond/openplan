import { describe, expect, it } from "vitest";
import {
  GRANTS_GOV_DEFAULT_ROWS,
  GRANTS_GOV_DEFAULT_STATUSES,
  GRANTS_GOV_SYNC_CAVEAT,
  GRANTS_GOV_TRANSPORTATION_CATEGORY,
  buildGrantsGovSearchBody,
  describeGrantsGovWindow,
  parseGrantsGovDate,
  parseGrantsGovSearchResponse,
  toFundingOpportunityDraft,
  type GrantsGovOpportunity,
} from "@/lib/grants/grants-gov";

// Fixture trimmed from a real Search2 response captured 2026-07-18
// (POST https://api.grants.gov/v1/api/search2, fundingCategories "T").
const REAL_RESPONSE = {
  errorcode: 0,
  msg: "Webservice Succeeds",
  token: "ignored",
  data: {
    searchParams: { rows: 3 },
    hitCount: 11,
    startRecord: 0,
    oppHits: [
      {
        id: "362478",
        number: "693JF725R000010",
        title: "Fiscal Year 2026 United States Marine Highway Program (USMHP)",
        agencyCode: "DOT-MA",
        agency: "Maritime Administration",
        openDate: "07/06/2026",
        closeDate: "08/31/2026",
        oppStatus: "posted",
        docType: "synopsis",
        cfdaList: ["20.816"],
      },
      {
        id: "363122",
        number: "FTA-2026-012-TPM-ICAM",
        title: "FY 2026 Notice of Funding Opportunity: Innovative Coordinated Access and Mobility Pilot Program",
        agencyCode: "DOT-FTA",
        agency: "DOT - Federal Transit Administration",
        openDate: "07/09/2026",
        closeDate: "09/09/2026",
        oppStatus: "posted",
        docType: "synopsis",
        cfdaList: ["20.537"],
      },
    ],
  },
};

function opportunity(overrides: Partial<GrantsGovOpportunity> = {}): GrantsGovOpportunity {
  return {
    id: "362478",
    number: "693JF725R000010",
    title: "Fiscal Year 2026 United States Marine Highway Program (USMHP)",
    agencyCode: "DOT-MA",
    agencyName: "Maritime Administration",
    openDate: "2026-07-06",
    closeDate: "2026-08-31",
    status: "posted",
    cfdaList: ["20.816"],
    detailUrl: "https://www.grants.gov/search-results-detail/362478",
    ...overrides,
  };
}

describe("buildGrantsGovSearchBody", () => {
  it("defaults to transportation-category posted+forecasted searches", () => {
    expect(buildGrantsGovSearchBody()).toEqual({
      keyword: "",
      rows: GRANTS_GOV_DEFAULT_ROWS,
      oppStatuses: GRANTS_GOV_DEFAULT_STATUSES,
      fundingCategories: GRANTS_GOV_TRANSPORTATION_CATEGORY,
    });
  });

  it("trims the keyword and rejects out-of-range rows", () => {
    expect(buildGrantsGovSearchBody({ keyword: "  transit  " }).keyword).toBe("transit");
    expect(() => buildGrantsGovSearchBody({ rows: 0 })).toThrow();
    expect(() => buildGrantsGovSearchBody({ rows: 101 })).toThrow();
    expect(() => buildGrantsGovSearchBody({ rows: 2.5 })).toThrow();
  });
});

describe("parseGrantsGovDate", () => {
  it("converts MM/DD/YYYY to ISO", () => {
    expect(parseGrantsGovDate("07/06/2026")).toBe("2026-07-06");
    expect(parseGrantsGovDate("12/31/2027")).toBe("2027-12-31");
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseGrantsGovDate("2026-07-06")).toBeNull();
    expect(parseGrantsGovDate("7/6/2026")).toBeNull();
    expect(parseGrantsGovDate("02/31/2026")).toBeNull();
    expect(parseGrantsGovDate("")).toBeNull();
    expect(parseGrantsGovDate(null)).toBeNull();
    expect(parseGrantsGovDate(20260706)).toBeNull();
  });
});

describe("parseGrantsGovSearchResponse", () => {
  it("parses the real response shape", () => {
    const result = parseGrantsGovSearchResponse(REAL_RESPONSE);
    expect(result).not.toBeNull();
    expect(result!.hitCount).toBe(11);
    expect(result!.opportunities).toHaveLength(2);
    expect(result!.opportunities[0]).toEqual(opportunity());
  });

  it("returns null on error payloads and non-objects", () => {
    expect(parseGrantsGovSearchResponse({ errorcode: 1, msg: "nope" })).toBeNull();
    expect(parseGrantsGovSearchResponse(null)).toBeNull();
    expect(parseGrantsGovSearchResponse("<html>Service Unavailable</html>")).toBeNull();
    expect(parseGrantsGovSearchResponse({ errorcode: 0 })).toBeNull();
  });

  it("skips hits without an id or title and tolerates missing fields", () => {
    const result = parseGrantsGovSearchResponse({
      errorcode: 0,
      data: {
        hitCount: 3,
        oppHits: [
          { id: "1", title: "Valid minimal hit" },
          { title: "No id" },
          { id: "3" },
          "not an object",
        ],
      },
    });
    expect(result!.opportunities).toHaveLength(1);
    const minimal = result!.opportunities[0];
    expect(minimal.agencyName).toBeNull();
    expect(minimal.openDate).toBeNull();
    expect(minimal.closeDate).toBeNull();
    expect(minimal.status).toBe("unknown");
    expect(minimal.cfdaList).toEqual([]);
    expect(minimal.detailUrl).toBe("https://www.grants.gov/search-results-detail/1");
  });

  it("accepts numeric ids", () => {
    const result = parseGrantsGovSearchResponse({
      errorcode: 0,
      data: { hitCount: 1, oppHits: [{ id: 362478, title: "Numeric id hit" }] },
    });
    expect(result!.opportunities[0].id).toBe("362478");
  });
});

describe("describeGrantsGovWindow", () => {
  const NOW = new Date("2026-07-18T12:00:00Z");

  it("labels forecasted notices with the estimated open date", () => {
    expect(describeGrantsGovWindow(opportunity({ status: "forecasted" }), NOW)).toEqual({
      label: "Forecasted — estimated open Jul 6, 2026",
      tone: "info",
    });
    expect(
      describeGrantsGovWindow(opportunity({ status: "forecasted", openDate: null }), NOW).label
    ).toContain("not yet published");
  });

  it("escalates tone as the close date approaches", () => {
    // 2026-08-31 is 44+ days past NOW → neutral.
    expect(describeGrantsGovWindow(opportunity(), NOW).tone).toBe("neutral");
    // 25 days out → warning. ceil((08-12T23:59:59Z - 07-18T12:00Z)/day) = 26.
    expect(describeGrantsGovWindow(opportunity({ closeDate: "2026-08-12" }), NOW)).toEqual({
      label: "Closes Aug 12, 2026 — 26 days left",
      tone: "warning",
    });
    // 8 days out → danger.
    expect(describeGrantsGovWindow(opportunity({ closeDate: "2026-07-25" }), NOW).tone).toBe("danger");
    // Past → neutral "Closed".
    expect(describeGrantsGovWindow(opportunity({ closeDate: "2026-07-01" }), NOW).label).toBe(
      "Closed Jul 1, 2026"
    );
  });

  it("reports Closed, not '0 days left', for the whole day after the deadline", () => {
    // Regression: daysLeft === 0 means now is past the 23:59:59Z close.
    expect(describeGrantsGovWindow(opportunity({ closeDate: "2026-07-17" }), NOW)).toEqual({
      label: "Closed Jul 17, 2026",
      tone: "neutral",
    });
    // On the deadline day itself it still counts 1 day left.
    expect(
      describeGrantsGovWindow(opportunity({ closeDate: "2026-07-18" }), NOW)
    ).toEqual({ label: "Closes Jul 18, 2026 — 1 day left", tone: "danger" });
  });

  it("is honest when a posted notice has no close date", () => {
    expect(describeGrantsGovWindow(opportunity({ closeDate: null }), NOW)).toEqual({
      label: "Posted — no close date published; check the NOFO",
      tone: "neutral",
    });
  });
});

describe("toFundingOpportunityDraft", () => {
  it("builds a create body with real dates and a verification-first summary", () => {
    const draft = toFundingOpportunityDraft(opportunity());
    expect(draft.title).toBe("Fiscal Year 2026 United States Marine Highway Program (USMHP)");
    expect(draft.agencyName).toBe("Maritime Administration");
    expect(draft.status).toBe("open");
    expect(draft.opensAt).toBe("2026-07-06T00:00:00.000Z");
    expect(draft.closesAt).toBe("2026-08-31T23:59:59.000Z");
    expect(draft.cadenceLabel).toBe("grants.gov posted — closes Aug 31, 2026; verify the NOFO.");
    expect(draft.summary).toContain("693JF725R000010");
    expect(draft.summary).toContain("20.816");
    expect(draft.summary).toContain("https://www.grants.gov/search-results-detail/362478");
    expect(draft.summary).toContain("Verify eligibility, match, and deadlines");
  });

  it("truncates long titles to the create schema's 160-char limit", () => {
    const draft = toFundingOpportunityDraft(opportunity({ title: "x".repeat(300) }));
    expect(draft.title.length).toBeLessThanOrEqual(160);
    expect(draft.title.endsWith("…")).toBe(true);
  });

  it("omits date fields when grants.gov did not publish them", () => {
    const draft = toFundingOpportunityDraft(opportunity({ openDate: null, closeDate: null }));
    expect(draft.opensAt).toBeUndefined();
    expect(draft.closesAt).toBeUndefined();
    expect(draft.cadenceLabel).toBe("grants.gov posted — verify current timing in the NOFO.");
  });

  it("leaves forecasted notices on the route's upcoming default", () => {
    expect(toFundingOpportunityDraft(opportunity({ status: "forecasted" })).status).toBeUndefined();
  });

  it("never leaves a lone surrogate when truncation cuts inside an emoji", () => {
    // Position an astral-plane character so the 159-code-unit cut lands
    // between its surrogate halves.
    const title = `${"x".repeat(158)}😀${"y".repeat(50)}`;
    const draft = toFundingOpportunityDraft(opportunity({ title }));
    expect(draft.title.length).toBeLessThanOrEqual(160);
    // encodeURIComponent throws URIError on lone surrogates.
    expect(() => encodeURIComponent(draft.title)).not.toThrow();
    expect(draft.title.endsWith("…")).toBe(true);
  });
});

describe("caveat literal", () => {
  it("is pinned verbatim", () => {
    expect(GRANTS_GOV_SYNC_CAVEAT).toBe(
      "Live results from the grants.gov Search API — synopsis-level only. Always verify eligibility, match, and deadlines in the full NOFO on grants.gov before planning an application."
    );
  });
});
