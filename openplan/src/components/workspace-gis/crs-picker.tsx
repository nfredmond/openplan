"use client";

/**
 * "Which coordinate system is this file in?" — asked, never guessed.
 *
 * A shapefile with no `.prj` is the common case in a planning department, not
 * the exotic one, and the old behaviour was to refuse it outright. This is the
 * refusal turned into a question.
 *
 * ═══ WHY THE LIST IS NARROWED, AND WHY THAT IS NOT A GUESS ═══
 *
 * OpenPlan carries every US coordinate system whose projection method it
 * implements — hundreds of them. Presented as one list, the question is
 * unanswerable: a planner scrolling past every other state's zones, the
 * statewide Albers systems and the Aleutian zones cannot pick with any
 * confidence. Narrowed to the systems whose AREA OF USE actually covers their
 * own workspace's geography, the list is a few dozen and the right answer is
 * usually visible.
 *
 * That narrowing is a filter on where the systems are DEFINED to work — a fact
 * published by the issuing authority — and not a ranking of which is likely.
 * OpenPlan never preselects one. Whichever the planner picks is recorded as
 * THEIR statement, with their name on it, and it is still checked against the
 * area of use before anything is stored.
 */

import { useEffect, useMemo, useState } from "react";

import type { CrsPickerOption } from "@/lib/cartographic/crs-http-types";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";

import { fetchCrsByCode, fetchCrsOptions } from "./crs-client";

export function CrsPicker({
  region,
  regionUnreadable = false,
  onChoose,
  onCancel,
}: {
  /** The workspace's geography, or null when it has never stated one. */
  region: [number, number, number, number] | null;
  /**
   * True when the geography could not be READ.
   *
   * THREE STATES, NOT TWO, and the third is why this prop exists. "Narrowed to
   * your area", "you have not stated an area", and "OpenPlan could not read your
   * area" are three different things to tell a planner, and the last two are
   * routinely collapsed into the second — which sends somebody looking for a
   * setting that is already set, at the exact moment they are being asked to
   * make a claim about where their data belongs.
   */
  regionUnreadable?: boolean;
  onChoose: (entry: CrsRegistryEntry, siblings: CrsRegistryEntry[]) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<CrsPickerOption[] | null>(null);
  const [unscoped, setUnscoped] = useState(false);
  const [matchedCount, setMatchedCount] = useState(0);
  const [filter, setFilter] = useState("");
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setError(null);
    fetchCrsOptions(region)
      .then((response) => {
        if (cancelled) return;
        setOptions(response.options ?? []);
        setUnscoped(Boolean(response.unscoped));
        setMatchedCount(response.matchedCount ?? 0);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The list of coordinate systems could not be loaded."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  /**
   * A plain substring match over what is already on screen — NEVER a fuzzy one.
   *
   * The registry itself matches a `.prj` by authority code first and exact alias
   * second, precisely because a near-miss on a zone name is the failure this
   * whole module exists to prevent. This box narrows a list a person is reading;
   * it does not choose anything, and it cannot promote a near-match to a match.
   */
  const shown = useMemo(() => {
    if (!options) return [];
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(needle) ||
        option.id.toLowerCase().includes(needle) ||
        option.areaDescription.toLowerCase().includes(needle)
    );
  }, [options, filter]);

  const choose = async (option: CrsPickerOption) => {
    setLoadingCode(option.id);
    setError(null);
    try {
      const identified = await fetchCrsByCode(option.id);
      if (!identified.ok) {
        setError(identified.message);
        return;
      }
      onChoose(identified.entry, identified.siblings ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That coordinate system could not be loaded."
      );
    } finally {
      setLoadingCode(null);
    }
  };

  return (
    <div className="op-crs-picker">
      {options === null && !error ? <p role="status">Loading coordinate systems…</p> : null}

      {error ? (
        <p className="op-crs-picker__error" role="alert">
          {error}
        </p>
      ) : null}

      {options !== null ? (
        <>
          <p className="op-crs-picker__scope">
            {regionUnreadable
              ? "OpenPlan could not read this workspace's geography just now, so this list is not narrowed to " +
                "your area — it is the start of every system OpenPlan carries. That is a failed read, not a " +
                "finding that your workspace has no geography set."
              : unscoped
                ? // SAID OUT LOUD. With no home geography there is nothing to
                  // narrow by, and a long list presented as though it were a
                  // shortlist would invite picking the first plausible row.
                  "This workspace has not stated a geography, so this list is not narrowed to your area — " +
                  "it is the start of every system OpenPlan carries. Set your workspace geography to get a " +
                  "list you can actually read."
                : `${matchedCount.toLocaleString()} coordinate systems are defined to cover your workspace's ` +
                  `area. OpenPlan does not pick one for you.`}
          </p>

          <label className="op-crs-picker__filter">
            <span className="sr-only">Filter coordinate systems</span>
            <input
              type="text"
              value={filter}
              placeholder="Filter by name, code or area — e.g. “zone 2”, “2226”, “feet”"
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>

          <ul className="op-crs-picker__list" role="list">
            {shown.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="op-crs-picker__option"
                  disabled={loadingCode !== null}
                  onClick={() => void choose(option)}
                >
                  <span className="op-crs-picker__name">{option.name}</span>
                  <span className="op-crs-picker__meta">
                    {option.id} · {option.unit}
                  </span>
                  <span className="op-crs-picker__area">{option.areaDescription}</span>
                  {option.requiresDatumAcknowledgement ? (
                    // Flagged in the LIST, not only after choosing: a planner
                    // deciding between the NAD83 and NAD27 spelling of their
                    // zone should see which one carries a positional caveat
                    // while they are still deciding.
                    <span className="op-crs-picker__caveat">
                      Older datum — carries a positional caveat
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {shown.length === 0 ? (
            <p className="op-crs-picker__empty">
              Nothing here matches “{filter}”. That is not a finding that the system does not exist
              — OpenPlan carries only the systems whose projection it can compute, and it names any
              system it cannot rather than substituting a nearby one.
            </p>
          ) : null}
        </>
      ) : null}

      <button type="button" className="op-cart-btn" onClick={onCancel}>
        Cancel this upload
      </button>
    </div>
  );
}
