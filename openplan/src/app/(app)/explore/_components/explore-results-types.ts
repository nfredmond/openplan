import type { MetricDelta } from "@/lib/analysis/compare";
import type { SourceTransparencyItem } from "@/lib/analysis/source-transparency";
import type { StatusTone } from "@/lib/ui/status";

export type ResultScoreTile = {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
};

export type ResultStatusBadge = {
  label: string;
  tone: StatusTone;
};

export type MapViewSummaryItem = {
  label: string;
  value: string;
};

export type MapViewComparisonRow = {
  label: string;
  current: string;
  baseline: string;
  changed: boolean;
};

export type PlanningSignal = {
  label: string;
  value: string;
  note: string;
};

export type GeospatialSourceCard = {
  label: string;
  status: string;
  detail: string;
  tone: StatusTone;
};

export type DisclosureItem = {
  title: string;
  detail: string;
  tone: StatusTone;
};

export type ComparisonNarrativeLead = {
  title: string;
  detail: string;
  tone: StatusTone;
};

export type ComparisonDelta = MetricDelta;
export type SourceTransparency = SourceTransparencyItem;
