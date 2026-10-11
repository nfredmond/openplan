"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import {
  buildPlaceSearchUrl,
  parsePlaceSearchResults,
  PLACE_SEARCH_MIN_LENGTH,
  type PlaceSearchResult,
} from "@/lib/engagement/place-search";

const DEBOUNCE_MS = 300;

type Status = "idle" | "loading" | "done" | "failed";

/**
 * FIND A STREET OR PLACE — a combobox over Mapbox's geocoder.
 *
 * A result moves the map and hands focus to it, so a keyboard user can press
 * Enter to mark the spot the search found. It never marks on its own: the
 * resident decides where they mean.
 */
export function PublicMapPlaceSearch({
  token,
  translator,
  getProximity,
  onChoose,
}: {
  token: string;
  translator: PortalTranslator;
  /** The map's centre, to rank nearby places first. */
  getProximity: () => [number, number] | null;
  onChoose: (result: PlaceSearchResult) => void;
}) {
  const { t } = translator;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const requestRef = useRef<AbortController | null>(null);
  /** The name a resident just chose; putting it in the box is not a new search. */
  const chosenRef = useRef<string | null>(null);
  // Read at search time, not as an effect dependency: the map's centre changes
  // on every pan and must not re-run a search.
  const proximityRef = useRef(getProximity);
  proximityRef.current = getProximity;

  useEffect(() => {
    const trimmed = query.trim();
    requestRef.current?.abort();
    // A new query invalidates the old results at once, so Enter during the
    // debounce cannot choose a place from the previous search.
    setResults([]);
    setActive(-1);
    if (chosenRef.current !== null && query === chosenRef.current) {
      setStatus("idle");
      return;
    }
    chosenRef.current = null;
    if (trimmed.length < PLACE_SEARCH_MIN_LENGTH) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const response = await fetch(
          buildPlaceSearchUrl(trimmed, {
            token,
            language: translator.bcp47,
            proximity: proximityRef.current(),
          }),
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`geocoder ${response.status}`);
        const found = parsePlaceSearchResults(await response.json());
        setResults(found);
        setActive(found.length > 0 ? 0 : -1);
        setStatus("done");
        setOpen(true);
      } catch {
        if (controller.signal.aborted) return;
        setResults([]);
        setStatus("failed");
        setOpen(true);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, token, translator.bcp47]);

  const choose = (result: PlaceSearchResult) => {
    setOpen(false);
    chosenRef.current = result.name;
    setQuery(result.name);
    onChoose(result);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((previous) => (previous + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActive((previous) => (previous <= 0 ? results.length - 1 : previous - 1));
    } else if (event.key === "Enter") {
      // Never submits a form: this box sits outside the comment form, but a
      // stray Enter must not do anything a resident did not ask for.
      event.preventDefault();
      const chosen = results[active >= 0 ? active : 0];
      if (open && chosen) choose(chosen);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        event.preventDefault();
        setQuery("");
      }
    }
  };

  const showList = open && status !== "idle" && status !== "loading";

  return (
    <div className="relative" data-testid="portal-place-search">
      <label className="relative block">
        <span className="sr-only">{t("portal.placeSearch")}</span>
        <Search
          className="pointer-events-none absolute start-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={t("portal.placeSearch")}
          className="h-11 w-full rounded-xl border border-border/60 bg-background/95 pe-3 ps-9 text-sm shadow-lg outline-none backdrop-blur-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </label>
      <ul
        id={listId}
        role="listbox"
        aria-label={t("portal.placeSearch")}
        hidden={!showList || results.length === 0}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-background py-1 text-sm shadow-xl"
      >
        {results.map((result, index) => (
          <li
            key={result.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown, not click: a click arrives after the input's blur
            // has already closed the list.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(result);
            }}
            onMouseEnter={() => setActive(index)}
            className={cn("cursor-pointer px-3 py-2", index === active ? "bg-[color:var(--pine)]/15" : "")}
          >
            {/* Place names are Mapbox's, in the language asked for when it has one. */}
            <span className="block font-medium text-foreground">{result.name}</span>
            {result.detail ? <span className="block text-xs text-muted-foreground">{result.detail}</span> : null}
          </li>
        ))}
      </ul>
      {/*
        What the search found, said aloud. A message is not an option, so it
        lives outside the listbox; visible only when there is nothing to pick.
      */}
      <p
        role="status"
        aria-live="polite"
        data-testid="portal-place-search-status"
        className={cn(
          "absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground shadow-xl",
          showList && results.length === 0 ? "" : "sr-only"
        )}
      >
        {status === "failed"
          ? t("portal.placeSearchFailed")
          : status === "done"
            ? results.length === 0
              ? t("portal.placeSearchNoResults")
              : t("portal.placeSearchCount", { count: results.length })
            : ""}
      </p>
    </div>
  );
}
