"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useCountyGeographySearch, useCountyRunMutations, useCountyRuns } from "@/lib/hooks/use-county-onramp";
import type { CountyGeographySearchItem } from "@/lib/api/county-geographies";
import type { CountyRunListItem } from "@/lib/api/county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import {
  ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE,
  buildCountyRuntimeOptions,
  COUNTY_RUNTIME_PRESET_DEFINITIONS,
  type CountyRuntimePresetKey,
} from "@/lib/models/county-runtime-presets";
import {
  buildCountyBehavioralRuntimeSummary,
  buildCountyRunSummaryCounts,
  buildCountyRunUiCard,
  filterCountyRunListItemsByQuickView,
  getCountyBehavioralReadinessBadge,
  sortCountyRunListItems,
  type CountyRunQuickView,
  type CountyRunSort,
} from "@/lib/ui/county-onramp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

const COUNTY_BEHAVIORAL_FILTER_OPTIONS = [
  { value: "all", label: "All behavioral states" },
  { value: "comparison-ready", label: "Comparison-ready" },
  { value: "preflight-only", label: "Preflight only" },
  { value: "runtime-failed", label: "Runtime failed" },
  { value: "lane-requested", label: "Lane requested" },
] as const;

const COUNTY_BEHAVIORAL_RUNTIME_STATUS_OPTIONS = [
  { value: "all", label: "All runtime statuses" },
  { value: "behavioral_runtime_succeeded", label: "Runtime succeeded" },
  { value: "behavioral_runtime_blocked", label: "Runtime blocked" },
  { value: "behavioral_runtime_failed", label: "Runtime failed" },
] as const;

const COUNTY_BEHAVIORAL_RUNTIME_MODE_OPTIONS = [
  { value: "all", label: "All runtime modes" },
  { value: "preflight_only", label: "Preflight only" },
  { value: "containerized_activitysim", label: "Containerized ActivitySim" },
] as const;

const COUNTY_RUN_SORT_OPTIONS: { value: CountyRunSort; label: string }[] = [
  { value: "updated-desc", label: "Recently updated" },
  { value: "stage-desc", label: "Most complete stage" },
  { value: "final-gap-asc", label: "Lowest final gap" },
  { value: "median-ape-asc", label: "Lowest median APE" },
];

const COUNTY_RUN_QUICK_VIEW_OPTIONS: { value: CountyRunQuickView; label: string }[] = [
  { value: "all", label: "All runs" },
  { value: "needs-attention", label: "Needs attention" },
  { value: "best-validated", label: "Best validated" },
  { value: "prototype-blocked", label: "Prototype blocked" },
  { value: "comparison-ready", label: "Comparison-ready" },
];

const COUNTY_SUMMARY_TILES: {
  key: "totalRuns" | "needsAttention" | "prototypeBlocked" | "comparisonReady" | "validatedScreening";
  label: string;
  quickView: CountyRunQuickView;
  className: string;
}[] = [
  {
    key: "totalRuns",
    label: "Total runs",
    quickView: "all",
    className: "border border-border/70 bg-background/70",
  },
  {
    key: "needsAttention",
    label: "Needs attention",
    quickView: "needs-attention",
    className: "border border-amber-500/30 bg-amber-500/10",
  },
  {
    key: "prototypeBlocked",
    label: "Prototype blocked",
    quickView: "prototype-blocked",
    className: "border border-amber-500/30 bg-amber-500/10",
  },
  {
    key: "comparisonReady",
    label: "Comparison-ready",
    quickView: "comparison-ready",
    className: "border border-emerald-500/30 bg-emerald-500/10",
  },
  {
    key: "validatedScreening",
    label: "Validated screening",
    quickView: "best-validated",
    className: "border border-sky-500/30 bg-sky-500/10",
  },
];

type CountyBehavioralFilter = (typeof COUNTY_BEHAVIORAL_FILTER_OPTIONS)[number]["value"];
type CountyBehavioralRuntimeStatusFilter = (typeof COUNTY_BEHAVIORAL_RUNTIME_STATUS_OPTIONS)[number]["value"];
type CountyBehavioralRuntimeModeFilter = (typeof COUNTY_BEHAVIORAL_RUNTIME_MODE_OPTIONS)[number]["value"];

function parseCountyBehavioralFilter(value: string | null | undefined): CountyBehavioralFilter {
  return COUNTY_BEHAVIORAL_FILTER_OPTIONS.some((option) => option.value === value)
    ? (value as CountyBehavioralFilter)
    : "all";
}

function parseCountyBehavioralRuntimeStatusFilter(
  value: string | null | undefined
): CountyBehavioralRuntimeStatusFilter {
  return COUNTY_BEHAVIORAL_RUNTIME_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as CountyBehavioralRuntimeStatusFilter)
    : "all";
}

function parseCountyBehavioralRuntimeModeFilter(
  value: string | null | undefined
): CountyBehavioralRuntimeModeFilter {
  return COUNTY_BEHAVIORAL_RUNTIME_MODE_OPTIONS.some((option) => option.value === value)
    ? (value as CountyBehavioralRuntimeModeFilter)
    : "all";
}

function parseCountyRunSort(value: string | null | undefined): CountyRunSort {
  return COUNTY_RUN_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as CountyRunSort)
    : "updated-desc";
}

function parseCountyRunQuickView(value: string | null | undefined): CountyRunQuickView {
  return COUNTY_RUN_QUICK_VIEW_OPTIONS.some((option) => option.value === value)
    ? (value as CountyRunQuickView)
    : "all";
}

function getCountyQuickViewDefaultSort(view: CountyRunQuickView): CountyRunSort {
  if (view === "best-validated" || view === "comparison-ready") {
    return "median-ape-asc";
  }
  if (view === "prototype-blocked") {
    return "final-gap-asc";
  }
  return "updated-desc";
}

function getCountyFilterOptionLabel(
  options: readonly { value: string; label: string }[],
  value: string
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function matchesCountyBehavioralFilter(item: CountyRunListItem, filter: CountyBehavioralFilter): boolean {
  switch (filter) {
    case "comparison-ready":
      return Boolean(item.behavioralComparisonReady);
    case "preflight-only":
      return item.behavioralPipelineStatus === "prototype_preflight_complete";
    case "runtime-failed":
      return (
        item.behavioralPipelineStatus === "behavioral_runtime_failed" ||
        item.behavioralRuntimeStatus === "behavioral_runtime_failed"
      );
    case "lane-requested":
      return (
        item.runtimePresetLabel === "Containerized behavioral smoke runtime (prototype)" &&
        !item.behavioralPipelineStatus
      );
    case "all":
    default:
      return true;
  }
}

function matchesCountyBehavioralRuntimeStatusFilter(
  item: CountyRunListItem,
  filter: CountyBehavioralRuntimeStatusFilter
): boolean {
  if (filter === "all") return true;
  return item.behavioralRuntimeStatus === filter;
}

function matchesCountyBehavioralRuntimeModeFilter(
  item: CountyRunListItem,
  filter: CountyBehavioralRuntimeModeFilter
): boolean {
  if (filter === "all") return true;
  return item.behavioralRuntimeMode === filter;
}

export function CountyRunsPageClient({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { items, loading, error, refresh } = useCountyRuns({
    workspaceId,
    limit: 25,
    refreshMs: 15000,
  });
  const { create, loading: creating, error: createError } = useCountyRunMutations();
  const [countyQuery, setCountyQuery] = useState("");
  const [selectedCounty, setSelectedCounty] = useState<CountyGeographySearchItem | null>(null);
  const [runName, setRunName] = useState("");
  const [runtimePreset, setRuntimePreset] = useState<CountyRuntimePresetKey>("standard");
  const [behavioralFilter, setBehavioralFilter] = useState<CountyBehavioralFilter>(() =>
    parseCountyBehavioralFilter(searchParams.get("behavioral"))
  );
  const [behavioralRuntimeStatusFilter, setBehavioralRuntimeStatusFilter] =
    useState<CountyBehavioralRuntimeStatusFilter>(() =>
      parseCountyBehavioralRuntimeStatusFilter(searchParams.get("runtimeStatus"))
    );
  const [behavioralRuntimeModeFilter, setBehavioralRuntimeModeFilter] = useState<CountyBehavioralRuntimeModeFilter>(() =>
    parseCountyBehavioralRuntimeModeFilter(searchParams.get("runtimeMode"))
  );
  const [countyRunSort, setCountyRunSort] = useState<CountyRunSort>(() => parseCountyRunSort(searchParams.get("sort")));
  const [countyRunQuickView, setCountyRunQuickView] = useState<CountyRunQuickView>(() => parseCountyRunQuickView(searchParams.get("view")));
  const { items: countyMatches, loading: searchLoading, error: searchError } = useCountyGeographySearch(countyQuery, {
    limit: 6,
  });

  const activeCounty = useMemo(() => {
    if (!selectedCounty) return null;
    const normalizedQuery = countyQuery.trim().toLowerCase();
    const matchesSelected =
      normalizedQuery === selectedCounty.geographyLabel.toLowerCase() || normalizedQuery === selectedCounty.geographyId;
    return matchesSelected ? selectedCounty : null;
  }, [countyQuery, selectedCounty]);

  const suggestedRunName = useMemo(() => activeCounty?.suggestedRunName ?? "", [activeCounty]);
  const selectedRuntimePreset = useMemo(
    () => COUNTY_RUNTIME_PRESET_DEFINITIONS.find((preset) => preset.key === runtimePreset) ?? COUNTY_RUNTIME_PRESET_DEFINITIONS[0],
    [runtimePreset]
  );
  const quickViewCounts = useMemo(
    () =>
      Object.fromEntries(
        COUNTY_RUN_QUICK_VIEW_OPTIONS.map((option) => [option.value, filterCountyRunListItemsByQuickView(items, option.value).length])
      ) as Record<CountyRunQuickView, number>,
    [items]
  );
  const summaryCounts = useMemo(() => buildCountyRunSummaryCounts(items), [items]);
  const quickViewItems = useMemo(
    () => filterCountyRunListItemsByQuickView(items, countyRunQuickView),
    [countyRunQuickView, items]
  );
  const filteredItems = useMemo(
    () =>
      quickViewItems.filter(
        (item) =>
          matchesCountyBehavioralFilter(item, behavioralFilter) &&
          matchesCountyBehavioralRuntimeStatusFilter(item, behavioralRuntimeStatusFilter) &&
          matchesCountyBehavioralRuntimeModeFilter(item, behavioralRuntimeModeFilter)
      ),
    [behavioralFilter, behavioralRuntimeModeFilter, behavioralRuntimeStatusFilter, quickViewItems]
  );
  const sortedItems = useMemo(() => sortCountyRunListItems(filteredItems, countyRunSort), [countyRunSort, filteredItems]);
  const hasActiveFilters =
    countyRunQuickView !== "all" ||
    behavioralFilter !== "all" ||
    behavioralRuntimeStatusFilter !== "all" ||
    behavioralRuntimeModeFilter !== "all";

  const replaceCountyRunsUrl = (params: URLSearchParams) => {
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  const updateCountyRunSort = (nextSort: CountyRunSort) => {
    setCountyRunSort(nextSort);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextSort === "updated-desc") {
      nextParams.delete("sort");
    } else {
      nextParams.set("sort", nextSort);
    }
    replaceCountyRunsUrl(nextParams);
  };

  const updateCountyRunQuickView = (nextView: CountyRunQuickView) => {
    const nextSort = getCountyQuickViewDefaultSort(nextView);
    setCountyRunQuickView(nextView);
    setCountyRunSort(nextSort);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextView === "all") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", nextView);
    }
    if (nextSort === "updated-desc") {
      nextParams.delete("sort");
    } else {
      nextParams.set("sort", nextSort);
    }
    replaceCountyRunsUrl(nextParams);
  };

  const applyCountyRunsFilters = (next: {
    behavioralFilter: CountyBehavioralFilter;
    behavioralRuntimeStatusFilter: CountyBehavioralRuntimeStatusFilter;
    behavioralRuntimeModeFilter: CountyBehavioralRuntimeModeFilter;
  }) => {
    setBehavioralFilter(next.behavioralFilter);
    setBehavioralRuntimeStatusFilter(next.behavioralRuntimeStatusFilter);
    setBehavioralRuntimeModeFilter(next.behavioralRuntimeModeFilter);

    const nextParams = new URLSearchParams(searchParams.toString());
    if (next.behavioralFilter === "all") {
      nextParams.delete("behavioral");
    } else {
      nextParams.set("behavioral", next.behavioralFilter);
    }

    if (next.behavioralRuntimeStatusFilter === "all") {
      nextParams.delete("runtimeStatus");
    } else {
      nextParams.set("runtimeStatus", next.behavioralRuntimeStatusFilter);
    }

    if (next.behavioralRuntimeModeFilter === "all") {
      nextParams.delete("runtimeMode");
    } else {
      nextParams.set("runtimeMode", next.behavioralRuntimeModeFilter);
    }

    replaceCountyRunsUrl(nextParams);
  };

  const updateBehavioralFilter = (nextFilter: CountyBehavioralFilter) => {
    applyCountyRunsFilters({
      behavioralFilter: nextFilter,
      behavioralRuntimeStatusFilter,
      behavioralRuntimeModeFilter,
    });
  };

  const updateBehavioralRuntimeStatusFilter = (nextFilter: CountyBehavioralRuntimeStatusFilter) => {
    applyCountyRunsFilters({
      behavioralFilter,
      behavioralRuntimeStatusFilter: nextFilter,
      behavioralRuntimeModeFilter,
    });
  };

  const updateBehavioralRuntimeModeFilter = (nextFilter: CountyBehavioralRuntimeModeFilter) => {
    applyCountyRunsFilters({
      behavioralFilter,
      behavioralRuntimeStatusFilter,
      behavioralRuntimeModeFilter: nextFilter,
    });
  };

  const clearAllCountyRunFilters = () => {
    setCountyRunQuickView("all");
    setCountyRunSort("updated-desc");
    setBehavioralFilter("all");
    setBehavioralRuntimeStatusFilter("all");
    setBehavioralRuntimeModeFilter("all");
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("view");
    nextParams.delete("sort");
    nextParams.delete("behavioral");
    nextParams.delete("runtimeStatus");
    nextParams.delete("runtimeMode");
    replaceCountyRunsUrl(nextParams);
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextRunName = runName.trim() || suggestedRunName;
    if (!activeCounty || !nextRunName) return;

    const created = await create({
      workspaceId,
      geographyType: "county_fips",
      geographyId: activeCounty.geographyId,
      geographyLabel: activeCounty.geographyLabel,
      runName: nextRunName,
      countyPrefix: activeCounty.countyPrefix,
      runtimeOptions: buildCountyRuntimeOptions(runtimePreset),
    });

    if (created?.countyRunId) {
      await refresh();
      router.push(`/county-runs/${created.countyRunId}`);
    }
  };

  return (
    <section className="module-page pb-10">
      <div className="module-intro-card">
        <div className="module-intro-kicker">County onboarding</div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">County runs</h1>
          <p className="module-intro-description">
            Track geography-first county onboarding from runtime build through validation scaffolding and bounded
            screening status.
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {COUNTY_SUMMARY_TILES.map((tile) => {
            const count = summaryCounts[tile.key];
            const active = countyRunQuickView === tile.quickView;

            return (
              <button
                key={tile.key}
                type="button"
                aria-label={`Summary tile: ${tile.label}`}
                onClick={() => updateCountyRunQuickView(tile.quickView)}
                className={`rounded-xl p-3 text-left transition hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${tile.className} ${
                  active ? "ring-2 ring-primary/40" : ""
                }`}
              >
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tile.label}</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{count}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Quick views</span>
          {COUNTY_RUN_QUICK_VIEW_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={countyRunQuickView === option.value ? "default" : "outline"}
              size="sm"
              onClick={() => updateCountyRunQuickView(option.value)}
            >
              {option.label} ({quickViewCounts[option.value] ?? 0})
            </Button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <div className="space-y-1">
            <label htmlFor="county-behavioral-filter" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Behavioral state
            </label>
            <select
              id="county-behavioral-filter"
              className="module-select min-w-[15rem]"
              value={behavioralFilter}
              onChange={(event) => updateBehavioralFilter(event.target.value as CountyBehavioralFilter)}
            >
              {COUNTY_BEHAVIORAL_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="county-runtime-status-filter" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Runtime status
            </label>
            <select
              id="county-runtime-status-filter"
              className="module-select min-w-[15rem]"
              value={behavioralRuntimeStatusFilter}
              onChange={(event) =>
                updateBehavioralRuntimeStatusFilter(event.target.value as CountyBehavioralRuntimeStatusFilter)
              }
            >
              {COUNTY_BEHAVIORAL_RUNTIME_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="county-runtime-mode-filter" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Runtime mode
            </label>
            <select
              id="county-runtime-mode-filter"
              className="module-select min-w-[15rem]"
              value={behavioralRuntimeModeFilter}
              onChange={(event) => updateBehavioralRuntimeModeFilter(event.target.value as CountyBehavioralRuntimeModeFilter)}
            >
              {COUNTY_BEHAVIORAL_RUNTIME_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="county-sort" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Sort by
            </label>
            <select
              id="county-sort"
              className="module-select min-w-[15rem]"
              value={countyRunSort}
              onChange={(event) => updateCountyRunSort(event.target.value as CountyRunSort)}
            >
              {COUNTY_RUN_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {sortedItems.length} of {items.length} county runs
          </div>
        </div>
        {hasActiveFilters ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Active filters</span>
            {countyRunQuickView !== "all" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => updateCountyRunQuickView("all")}>
                View: {getCountyFilterOptionLabel(COUNTY_RUN_QUICK_VIEW_OPTIONS, countyRunQuickView)} ×
              </Button>
            ) : null}
            {behavioralFilter !== "all" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  applyCountyRunsFilters({
                    behavioralFilter: "all",
                    behavioralRuntimeStatusFilter,
                    behavioralRuntimeModeFilter,
                  })
                }
              >
                Behavioral: {getCountyFilterOptionLabel(COUNTY_BEHAVIORAL_FILTER_OPTIONS, behavioralFilter)} ×
              </Button>
            ) : null}
            {behavioralRuntimeStatusFilter !== "all" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  applyCountyRunsFilters({
                    behavioralFilter,
                    behavioralRuntimeStatusFilter: "all",
                    behavioralRuntimeModeFilter,
                  })
                }
              >
                Runtime status: {getCountyFilterOptionLabel(COUNTY_BEHAVIORAL_RUNTIME_STATUS_OPTIONS, behavioralRuntimeStatusFilter)} ×
              </Button>
            ) : null}
            {behavioralRuntimeModeFilter !== "all" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  applyCountyRunsFilters({
                    behavioralFilter,
                    behavioralRuntimeStatusFilter,
                    behavioralRuntimeModeFilter: "all",
                  })
                }
              >
                Runtime mode: {getCountyFilterOptionLabel(COUNTY_BEHAVIORAL_RUNTIME_MODE_OPTIONS, behavioralRuntimeModeFilter)} ×
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={clearAllCountyRunFilters}>
              Clear all filters
            </Button>
          </div>
        ) : null}
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Launch county onboarding</CardTitle>
          <CardDescription>
            Create a county run record to begin the geography-first onboarding workflow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submitCreate}>
            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <label htmlFor="county-search" className="text-sm font-medium text-foreground">
                County search
              </label>
              <Input
                id="county-search"
                value={countyQuery}
                onChange={(e) => setCountyQuery(e.target.value)}
                placeholder="Nevada County, CA or 06057"
              />
              <p className="text-xs text-muted-foreground">Search any U.S. county by name or 5-digit FIPS. Select one result to launch the runtime bootstrap.</p>
            </div>

            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <label htmlFor="county-run-name" className="text-sm font-medium text-foreground">
                Run name
              </label>
              <Input
                id="county-run-name"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder={suggestedRunName || "county-runtime"}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the suggested run name derived from the selected county.</p>
            </div>

            <div className="md:col-span-2 xl:col-span-4 rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">Advanced runtime</div>
                  <p className="text-xs text-muted-foreground">
                    Choose whether this county bootstrap should stay on the standard path or request the shipped containerized ActivitySim smoke path.
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,20rem)_1fr]">
                <div className="space-y-2">
                  <label htmlFor="county-runtime-preset" className="text-sm font-medium text-foreground">
                    Runtime preset
                  </label>
                  <select
                    id="county-runtime-preset"
                    className="module-select w-full"
                    value={runtimePreset}
                    onChange={(event) => setRuntimePreset(event.target.value as CountyRuntimePresetKey)}
                  >
                    {COUNTY_RUNTIME_PRESET_DEFINITIONS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-border/70 bg-background/80 p-3 text-sm">
                  <div className="font-medium text-foreground">{selectedRuntimePreset.label}</div>
                  <p className="mt-1 text-muted-foreground">{selectedRuntimePreset.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{selectedRuntimePreset.caveat}</p>
                  {runtimePreset === "activitysim_behavioral_smoke" ? (
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Prototype runtime options sent on create</div>
                      <ul className="mt-2 space-y-1 font-mono">
                        <li>activitysimContainerImage: python:3.11-slim</li>
                        <li>containerEngineCli: docker</li>
                        <li>containerNetworkMode: bridge</li>
                        <li>activitysimContainerCliTemplate: {ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE}</li>
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="md:col-span-2 xl:col-span-4 space-y-3">
              {searchError ? <p className="text-sm text-destructive">{searchError}</p> : null}
              {!searchError && searchLoading ? <p className="text-sm text-muted-foreground">Searching counties…</p> : null}

              {!searchError && !searchLoading && countyQuery.trim().length >= 2 && !activeCounty && countyMatches.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {countyMatches.map((item) => (
                    <button
                      key={item.geographyId}
                      type="button"
                      onClick={() => {
                        setSelectedCounty(item);
                        setCountyQuery(item.geographyLabel);
                      }}
                      className="rounded-xl border border-border/70 bg-background px-3 py-3 text-left transition hover:border-primary/40 hover:bg-muted/40"
                    >
                      <div className="font-medium text-foreground">{item.geographyLabel}</div>
                      <div className="mt-1 text-xs text-muted-foreground">FIPS {item.geographyId} · Prefix {item.countyPrefix}</div>
                    </button>
                  ))}
                </div>
              ) : null}

              {activeCounty ? (
                <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Selected county</div>
                  <div className="mt-1">{activeCounty.geographyLabel}</div>
                  <div className="mt-1 text-xs">FIPS {activeCounty.geographyId} · Prefix {activeCounty.countyPrefix}</div>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-3 pt-1">
              <Button type="submit" disabled={creating || !activeCounty}>
                Launch county run
              </Button>
              {createError ? <span className="text-sm text-destructive">{createError}</span> : null}
              {!createError ? (
                <span className="text-sm text-muted-foreground">
                  This creates the county run record and initial stage state. If a worker endpoint is configured, enqueue can dispatch the background bootstrap directly.
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <ErrorState
          title="Unable to load county runs"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <EmptyState
          title="No county runs yet"
          description="Once county onboarding jobs are created, they will appear here with stage, caveats, and artifact access."
        />
      ) : null}

      {!error && !loading && items.length > 0 && sortedItems.length === 0 ? (
        <EmptyState
          title="No county runs match this behavioral filter"
          description="Try broader county behavioral filters to see more runs."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {sortedItems.map((item) => {
          const card = buildCountyRunUiCard({
            geographyLabel: item.geographyLabel,
            manifest: null,
            stage: item.stage,
          });
          const enqueueLabel = getCountyRunEnqueueStatusLabel(item.enqueueStatus ?? "not-enqueued");
          const enqueueTone = getCountyRunEnqueueStatusTone(item.enqueueStatus ?? "not-enqueued");
          const enqueueHelp = getCountyRunEnqueueHelpText(item.enqueueStatus ?? "not-enqueued");
          const behavioralBadge = getCountyBehavioralReadinessBadge({
            pipelineStatus: item.behavioralPipelineStatus,
            evidenceReady: item.behavioralEvidenceReady,
            comparisonReady: item.behavioralComparisonReady,
            evidenceStatusLabel: item.behavioralEvidenceStatusLabel,
            comparisonStatusLabel: item.behavioralComparisonStatusLabel,
          });
          const behavioralRuntime = buildCountyBehavioralRuntimeSummary({
            pipelineStatus: item.behavioralPipelineStatus,
            runtimeStatus: item.behavioralRuntimeStatus,
            runtimeMode: item.behavioralRuntimeMode,
          });

          return (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{item.geographyLabel}</CardTitle>
                    <CardDescription>{item.runName}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={card.tone}>{card.stageLabel}</StatusBadge>
                    {item.statusLabel ? <StatusBadge tone={card.tone}>{item.statusLabel}</StatusBadge> : null}
                    <StatusBadge tone={enqueueTone}>{enqueueLabel}</StatusBadge>
                    {behavioralBadge ? <StatusBadge tone={behavioralBadge.tone}>{behavioralBadge.label}</StatusBadge> : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="font-medium text-foreground">Allowed claim</div>
                  <p className="mt-1 text-muted-foreground">{card.allowedClaim}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Next action</div>
                  <p className="mt-1 text-muted-foreground">{card.nextAction}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Execution status</div>
                  <p className="mt-1 text-muted-foreground">{enqueueHelp}</p>
                  {item.lastEnqueuedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last enqueued {new Date(item.lastEnqueuedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                {item.runtimePresetLabel ? (
                  <div>
                    <div className="font-medium text-foreground">Runtime preset</div>
                    <p className="mt-1 text-muted-foreground">{item.runtimePresetLabel}</p>
                  </div>
                ) : null}
                {behavioralRuntime.pipelineLabel || behavioralRuntime.runtimeLabel || behavioralRuntime.modeLabel ? (
                  <div>
                    <div className="font-medium text-foreground">Behavioral runtime</div>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {behavioralRuntime.pipelineLabel ? <li>Pipeline status: {behavioralRuntime.pipelineLabel}</li> : null}
                      {behavioralRuntime.runtimeLabel ? <li>Runtime status: {behavioralRuntime.runtimeLabel}</li> : null}
                      {behavioralRuntime.modeLabel ? <li>Runtime mode: {behavioralRuntime.modeLabel}</li> : null}
                    </ul>
                  </div>
                ) : null}
                {item.behavioralEvidenceStatusLabel ? (
                  <div>
                    <div className="font-medium text-foreground">Behavioral evidence</div>
                    <p className="mt-1 text-muted-foreground">{item.behavioralEvidenceStatusLabel}</p>
                  </div>
                ) : null}
                {item.behavioralComparisonStatusLabel ? (
                  <div>
                    <div className="font-medium text-foreground">Behavioral comparison</div>
                    <p className="mt-1 text-muted-foreground">{item.behavioralComparisonStatusLabel}</p>
                  </div>
                ) : null}
                {item.artifactAvailabilityLabels && item.artifactAvailabilityLabels.length > 0 ? (
                  <div>
                    <div className="font-medium text-foreground">Artifacts</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.artifactAvailabilityLabels.map((label) => (
                        <StatusBadge key={label} tone={label === "Behavioral prototype" ? "info" : "neutral"}>
                          {label}
                        </StatusBadge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {item.metricAvailabilityLabels && item.metricAvailabilityLabels.length > 0 ? (
                  <div>
                    <div className="font-medium text-foreground">Metrics</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.metricAvailabilityLabels.map((label) => (
                        <StatusBadge key={label} tone="neutral">
                          {label}
                        </StatusBadge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-xs text-muted-foreground">Updated {new Date(item.updatedAt).toLocaleString()}</span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/county-runs/${item.id}`}>Open detail</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
