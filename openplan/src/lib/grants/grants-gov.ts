// Live federal opportunity discovery via the public grants.gov Search2 API.
//
// Pure helpers only — the fetch itself lives in the API route so the browser
// never talks to grants.gov directly and results can be cached server-side.
// Everything returned is synopsis-level: the NOFO on grants.gov is the record.

export const GRANTS_GOV_SEARCH_ENDPOINT = "https://api.grants.gov/v1/api/search2";

/** grants.gov funding category code for Transportation. */
export const GRANTS_GOV_TRANSPORTATION_CATEGORY = "T";

/** Statuses worth watching for a planning agency: open calls + forecasts. */
export const GRANTS_GOV_DEFAULT_STATUSES = "forecasted|posted";

export const GRANTS_GOV_DEFAULT_ROWS = 25;

export const GRANTS_GOV_SYNC_CAVEAT =
  "Live results from the grants.gov Search API — synopsis-level only. Always verify eligibility, match, and deadlines in the full NOFO on grants.gov before planning an application.";

export interface GrantsGovSearchOptions {
  keyword?: string;
  rows?: number;
  oppStatuses?: string;
  fundingCategories?: string;
}

export interface GrantsGovOpportunity {
  id: string;
  number: string;
  title: string;
  agencyCode: string | null;
  agencyName: string | null;
  /** ISO yyyy-mm-dd, converted from the API's MM/DD/YYYY; null when absent/unparseable. */
  openDate: string | null;
  closeDate: string | null;
  status: string;
  cfdaList: string[];
  detailUrl: string;
}

export interface GrantsGovSearchResult {
  hitCount: number;
  opportunities: GrantsGovOpportunity[];
}

export function buildGrantsGovSearchBody(options: GrantsGovSearchOptions = {}): {
  keyword: string;
  rows: number;
  oppStatuses: string;
  fundingCategories: string;
} {
  const rows = options.rows ?? GRANTS_GOV_DEFAULT_ROWS;
  if (!Number.isInteger(rows) || rows < 1 || rows > 100) {
    throw new Error(`grants.gov rows must be an integer between 1 and 100, got ${String(options.rows)}`);
  }
  return {
    keyword: (options.keyword ?? "").trim(),
    rows,
    oppStatuses: options.oppStatuses ?? GRANTS_GOV_DEFAULT_STATUSES,
    fundingCategories: options.fundingCategories ?? GRANTS_GOV_TRANSPORTATION_CATEGORY,
  };
}

/** "07/06/2026" → "2026-07-06"; null for anything that is not a real calendar date. */
export function parseGrantsGovDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject rollovers like 02/31 that Date silently normalizes.
  if (parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function coerceTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Defensive parse of the Search2 response. Returns null when the payload is
 * not a successful grants.gov response — callers surface an honest offline
 * state instead of guessing.
 */
export function parseGrantsGovSearchResponse(payload: unknown): GrantsGovSearchResult | null {
  if (typeof payload !== "object" || payload === null) return null;
  const root = payload as Record<string, unknown>;
  if (root.errorcode !== 0) return null;
  const data = root.data;
  if (typeof data !== "object" || data === null) return null;
  const dataRecord = data as Record<string, unknown>;
  const hitCount = typeof dataRecord.hitCount === "number" ? dataRecord.hitCount : 0;
  const rawHits = Array.isArray(dataRecord.oppHits) ? dataRecord.oppHits : [];

  const opportunities: GrantsGovOpportunity[] = [];
  for (const rawHit of rawHits) {
    if (typeof rawHit !== "object" || rawHit === null) continue;
    const hit = rawHit as Record<string, unknown>;
    const id = coerceTrimmedString(typeof hit.id === "number" ? String(hit.id) : hit.id);
    const title = coerceTrimmedString(hit.title);
    if (!id || !title) continue;
    opportunities.push({
      id,
      number: coerceTrimmedString(hit.number) ?? "",
      title,
      agencyCode: coerceTrimmedString(hit.agencyCode),
      agencyName: coerceTrimmedString(hit.agency),
      openDate: parseGrantsGovDate(hit.openDate),
      closeDate: parseGrantsGovDate(hit.closeDate),
      status: coerceTrimmedString(hit.oppStatus) ?? "unknown",
      cfdaList: Array.isArray(hit.cfdaList)
        ? hit.cfdaList.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      detailUrl: `https://www.grants.gov/search-results-detail/${encodeURIComponent(id)}`,
    });
  }

  return { hitCount, opportunities };
}

export type GrantsGovWindowTone = "info" | "neutral" | "warning" | "danger";

export interface GrantsGovWindow {
  label: string;
  tone: GrantsGovWindowTone;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatIsoDateLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Human window line for a list row. `now` is required so callers (and tests)
 * stay deterministic — the section passes the render-time date.
 */
export function describeGrantsGovWindow(
  opportunity: Pick<GrantsGovOpportunity, "status" | "openDate" | "closeDate">,
  now: Date
): GrantsGovWindow {
  if (opportunity.status === "forecasted") {
    return {
      label: opportunity.openDate
        ? `Forecasted — estimated open ${formatIsoDateLabel(opportunity.openDate)}`
        : "Forecasted — opening date not yet published",
      tone: "info",
    };
  }
  if (!opportunity.closeDate) {
    return { label: "Posted — no close date published; check the NOFO", tone: "neutral" };
  }
  const closeAt = new Date(`${opportunity.closeDate}T23:59:59Z`).getTime();
  const daysLeft = Math.ceil((closeAt - now.getTime()) / DAY_MS);
  const closeLabel = formatIsoDateLabel(opportunity.closeDate);
  // daysLeft hits 0 only once `now` has passed the close timestamp, so 0 means
  // closed — not "0 days left". Deadline day itself reads "1 day left".
  if (daysLeft <= 0) {
    return { label: `Closed ${closeLabel}`, tone: "neutral" };
  }
  if (daysLeft <= 14) {
    return { label: `Closes ${closeLabel} — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`, tone: "danger" };
  }
  if (daysLeft <= 30) {
    return { label: `Closes ${closeLabel} — ${daysLeft} days left`, tone: "warning" };
  }
  return { label: `Closes ${closeLabel}`, tone: "neutral" };
}

export function truncateForField(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  let head = value.slice(0, maxLength - 1);
  // Never split a surrogate pair at the cut point.
  const lastCodeUnit = head.charCodeAt(head.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    head = head.slice(0, -1);
  }
  return `${head.trimEnd()}…`;
}

export interface FundingOpportunityDraft {
  title: string;
  agencyName?: string;
  cadenceLabel: string;
  status?: "open" | "upcoming";
  opensAt?: string;
  closesAt?: string;
  summary: string;
}

/**
 * Body for POST /api/funding-opportunities (see createFundingOpportunitySchema:
 * title/agency/cadence ≤160, summary ≤4000, opensAt/closesAt ISO datetimes).
 * Open dates map to start-of-day UTC; close dates to end-of-day UTC so a
 * tracked opportunity is not treated as closed on its own deadline day.
 */
export function toFundingOpportunityDraft(opportunity: GrantsGovOpportunity): FundingOpportunityDraft {
  const summaryParts = [
    `grants.gov opportunity ${opportunity.number || opportunity.id} (${opportunity.status}).`,
    opportunity.cfdaList.length > 0 ? `Assistance listing: ${opportunity.cfdaList.join(", ")}.` : null,
    `Synopsis and NOFO: ${opportunity.detailUrl}`,
    "Verify eligibility, match, and deadlines in the full NOFO before planning an application.",
  ].filter((part): part is string => Boolean(part));

  return {
    title: truncateForField(opportunity.title, 160),
    agencyName: opportunity.agencyName ? truncateForField(opportunity.agencyName, 160) : undefined,
    // Posted calls are open for applications now; forecasted ones keep the
    // route's "upcoming" default.
    status: opportunity.status === "posted" ? "open" : undefined,
    cadenceLabel: truncateForField(
      opportunity.closeDate
        ? `grants.gov ${opportunity.status} — closes ${formatIsoDateLabel(opportunity.closeDate)}; verify the NOFO.`
        : `grants.gov ${opportunity.status} — verify current timing in the NOFO.`,
      160
    ),
    opensAt: opportunity.openDate ? `${opportunity.openDate}T00:00:00.000Z` : undefined,
    closesAt: opportunity.closeDate ? `${opportunity.closeDate}T23:59:59.000Z` : undefined,
    summary: truncateForField(summaryParts.join(" "), 4000),
  };
}
