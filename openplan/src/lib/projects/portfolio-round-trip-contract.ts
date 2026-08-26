import type { PortfolioImportMapping } from "@/lib/projects/portfolio-import";

export const PORTFOLIO_ROUND_TRIP_VERSION = 1;
export const PORTFOLIO_ROUND_TRIP_SHEET = "Projects";

export const PORTFOLIO_ROUND_TRIP_HEADERS = [
  "Project name",
  "OpenPlan project ID",
  "Description",
  "Estimated cost",
  "Cost currency",
  "Cost price year",
  "Project type",
  "Status",
  "Delivery phase",
  "Source-location text",
  "Place source",
  "Place kind",
  "Place reference",
  "Country code",
  "Subdivision code",
  "Cost source document ID",
  "Cost recorded at",
  "Created at",
  "Updated at",
] as const;

export const PORTFOLIO_ROUND_TRIP_MAPPING = {
  name: 0,
  sourceId: 1,
  description: 2,
  estimatedCost: 3,
  costCurrency: 4,
  costPriceYear: 5,
  planType: 6,
  status: 7,
  deliveryPhase: 8,
  sourceLocation: 9,
} as const;

/** Recognize only the exact OpenPlan header contract; near-matches stay manual. */
export function mappingForOpenPlanRoundTripHeaders(headers: string[]): PortfolioImportMapping | null {
  return headers.length === PORTFOLIO_ROUND_TRIP_HEADERS.length &&
    PORTFOLIO_ROUND_TRIP_HEADERS.every((header, index) => headers[index] === header)
    ? { ...PORTFOLIO_ROUND_TRIP_MAPPING }
    : null;
}
