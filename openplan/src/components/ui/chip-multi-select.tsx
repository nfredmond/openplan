"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ChipMultiSelectOption = {
  id: string;
  label: string;
  hint?: string | null;
};

type ChipMultiSelectProps = {
  id: string;
  options: ChipMultiSelectOption[];
  selectedIds: string[];
  onChange: (nextSelectedIds: string[]) => void;
  searchPlaceholder?: string;
  emptySelectionLabel?: string;
  emptyResultsLabel?: string;
  reservedIds?: string[];
  className?: string;
};

export function ChipMultiSelect({
  id,
  options,
  selectedIds,
  onChange,
  searchPlaceholder = "Search records to link…",
  emptySelectionLabel = "No records linked yet.",
  emptyResultsLabel = "No matching records available.",
  reservedIds = [],
  className,
}: ChipMultiSelectProps) {
  const [query, setQuery] = useState("");

  const reservedIdSet = useMemo(() => new Set(reservedIds.filter(Boolean)), [reservedIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const optionMap = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  const selectedOptions = useMemo(
    () =>
      selectedIds
        .map((id) => optionMap.get(id))
        .filter((option): option is ChipMultiSelectOption => {
          if (!option) {
            return false;
          }

          return !reservedIdSet.has(option.id);
        }),
    [optionMap, reservedIdSet, selectedIds]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const availableOptions = useMemo(
    () => options.filter((option) => !selectedIdSet.has(option.id) && !reservedIdSet.has(option.id)),
    [options, reservedIdSet, selectedIdSet]
  );
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return availableOptions;
    }

    return availableOptions.filter((option) => {
      const haystack = `${option.label} ${option.hint ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [availableOptions, normalizedQuery]);

  function addOption(id: string) {
    if (selectedIdSet.has(id) || reservedIdSet.has(id)) {
      return;
    }

    onChange([...selectedIds, id]);
    setQuery("");
  }

  function removeOption(id: string) {
    onChange(selectedIds.filter((selectedId) => selectedId !== id));
  }

  return (
    <div className={cn("border border-border/70 bg-background/70 p-4 shadow-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Linked records</p>
        <span className="module-record-chip">
          <span>Selected</span>
          <strong>{selectedOptions.length}</strong>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {selectedOptions.length > 0 ? (
          selectedOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => removeOption(option.id)}
              className="inline-flex items-center gap-1.5 border border-emerald-200/70 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-500/16"
              aria-label={`Remove ${option.label}`}
            >
              <span className="max-w-[16rem] truncate">{option.label}</span>
              <X className="h-3.5 w-3.5" />
            </button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{emptySelectionLabel}</p>
        )}
      </div>

      <div className="mt-4 space-y-3 border border-dashed border-border/70 bg-muted/20 p-3">
        <label htmlFor={`${id}-search`} className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Add records
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${id}-search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </div>

        {availableOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">All available records are already linked.</p>
        ) : filteredOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyResultsLabel}</p>
        ) : (
          <ScrollArea className="max-h-44 border border-border/60 bg-background/75">
            <div className="grid gap-2 p-2">
              {filteredOptions.slice(0, 12).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => addOption(option.id)}
                  className="flex items-center justify-between gap-3 border border-border/65 bg-background px-3 py-2 text-left transition hover:border-primary/35 hover:bg-primary/5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{option.label}</p>
                    {option.hint ? <p className="truncate text-xs text-muted-foreground">{option.hint}</p> : null}
                  </div>
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-border/70 bg-muted/35 text-muted-foreground">
                    <Plus className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        {filteredOptions.length > 12 ? (
          <p className="text-xs text-muted-foreground">Showing the first 12 matches. Refine search to narrow the list.</p>
        ) : null}
      </div>
    </div>
  );
}
