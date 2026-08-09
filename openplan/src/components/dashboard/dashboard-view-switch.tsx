"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, LayoutList } from "lucide-react";

export type DashboardView = "overview" | "insights";

const STORAGE_KEY = "dashboard-view";
const DEFAULT_VIEW: DashboardView = "overview";

function normalize(value: string | null): DashboardView {
  return value === "insights" ? "insights" : DEFAULT_VIEW;
}

/**
 * Switches the workspace dashboard between its two readings.
 *
 * "Overview" is the existing page and stays the DEFAULT — an operator opening
 * the product should find what they already know, and a workspace with no runs
 * has nothing to plot anyway. "Insights" reads the same workspace as figures.
 *
 * The choice is remembered per browser, because which reading you want is a
 * property of how you work rather than of the visit. It is deliberately NOT in
 * the URL: a dashboard link pasted into a board pack should open the view the
 * reader prefers, not the one the sender happened to be on.
 *
 * Both views are rendered on the server and one is hidden, rather than fetched
 * on switch. The data is already loaded for the page; a spinner between two
 * readings of the same numbers would be latency invented for no reason.
 */
export function DashboardViewSwitch({
  overview,
  insights,
}: {
  overview: ReactNode;
  insights: ReactNode;
}) {
  const [view, setView] = useState<DashboardView>(DEFAULT_VIEW);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      setView(normalize(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Storage can be unavailable; the default view is a fine answer.
    }
  }, []);

  function choose(next: DashboardView) {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same reason as above — the switch still works for this visit.
    }
  }

  const options: Array<{ id: DashboardView; label: string; icon: ReactNode }> = [
    { id: "overview", label: "Overview", icon: <LayoutList className="h-3.5 w-3.5" /> },
    { id: "insights", label: "Insights", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Dashboard view
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {view === "insights"
              ? "The same workspace read as figures. Nothing here is a forecast."
              : "Setup, records and the command board — the operator reading."}
          </p>
        </div>
        <div
          role="group"
          aria-label="Dashboard view"
          className="flex items-center gap-1 rounded-xl border border-border/70 bg-background/70 p-1"
        >
          {options.map((option) => {
            const current = view === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => choose(option.id)}
                aria-pressed={current}
                data-testid={`dashboard-view-${option.id}`}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  current
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/*
        Both trees stay mounted and one is hidden. Switching a reading of numbers
        you already have should be instant, and unmounting would throw away the
        table toggles a reader had opened inside the figures.

        Before mount the stored choice is unknown, so the default is shown —
        which is also what the server rendered, so hydration has nothing to
        correct.
      */}
      <div hidden={mounted && view !== "overview"}>{overview}</div>
      <div hidden={!mounted || view !== "insights"}>{insights}</div>
    </div>
  );
}
