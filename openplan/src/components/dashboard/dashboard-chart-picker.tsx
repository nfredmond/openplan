"use client";

import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";

import {
  DASHBOARD_CHARTS,
  DEFAULT_DASHBOARD_CHART_IDS,
  type DashboardChartId,
} from "@/lib/dashboard/chart-catalog";

/**
 * "Choose your figures" — the control that decides which charts the dashboard
 * draws for this person.
 *
 * IT IS LABELLED BY THE QUESTION, NOT BY THE CHART. A planner does not think
 * "I want a cumulative area plot"; they think "is the public actually
 * responding". So each row leads with the question the figure answers and puts
 * the figure's own title underneath, which is also the copy standard for this
 * app — plain words, no chart vocabulary.
 *
 * The panel is a plain disclosure rather than a modal: it closes on Escape and
 * on a click outside, changes take effect immediately, and nothing is
 * "applied". There is no Save button because there is nothing to save — the
 * choice is written the moment it is made.
 */
export function DashboardChartPicker({
  selected,
  onChange,
}: {
  selected: readonly DashboardChartId[];
  onChange: (next: DashboardChartId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(id: DashboardChartId) {
    onChange(
      selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]
    );
  }

  return (
    // `ml-auto` is load-bearing at phone width: the row above wraps, and
    // without it the button sits at the LEFT of its line while the panel hangs
    // off the right of the button — which put half the panel off-screen at
    // 390px. Pushed right, the panel's right-anchored edge lands inside the
    // card. Measured, not guessed.
    <div ref={containerRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="dashboard-chart-picker-toggle"
        className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        Choose figures
        <span className="tabular-nums text-foreground">
          {selected.length}/{DASHBOARD_CHARTS.length}
        </span>
      </button>

      {open ? (
        <div
          data-testid="dashboard-chart-picker-panel"
          /*
            NARROWER ON A PHONE, and the number was measured rather than
            picked. A 22rem panel dropped from this button hangs eleven pixels
            off the left edge at 390px; 17.5rem lands inside the same column
            the figure cards occupy. Anchoring it to the viewport instead was
            tried and is worse — the app shell's floating rail overlays the
            left edge of the content at that width, so a full-bleed panel goes
            under it.
          */
          className="absolute right-0 z-50 mt-2 w-[17.5rem] rounded-2xl border border-border/70 bg-card p-3 shadow-lg sm:w-[22rem]"
        >
          <p className="px-1 pb-2 text-xs leading-5 text-muted-foreground">
            Pick the figures you want on this dashboard. Your choice is remembered in this
            browser — sign in somewhere else and you will pick again.
          </p>
          <ul className="space-y-1">
            {DASHBOARD_CHARTS.map((chart) => {
              const on = selected.includes(chart.id);
              return (
                <li key={chart.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    data-testid={`dashboard-chart-toggle-${chart.id}`}
                    onClick={() => toggle(chart.id)}
                    className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary/60"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background"
                      }`}
                    >
                      {on ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        {chart.question}
                      </span>
                      <span className="block text-[0.7rem] leading-5 text-muted-foreground">
                        {chart.title}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-end gap-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded-lg px-2 py-1 text-[0.7rem] font-semibold text-muted-foreground hover:text-foreground"
            >
              Hide all
            </button>
            <button
              type="button"
              onClick={() => onChange([...DEFAULT_DASHBOARD_CHART_IDS])}
              className="rounded-lg px-2 py-1 text-[0.7rem] font-semibold text-muted-foreground hover:text-foreground"
            >
              Show all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
