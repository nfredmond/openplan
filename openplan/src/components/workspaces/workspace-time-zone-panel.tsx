"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceCalendar, WorkspaceTimeZoneSource } from "@/lib/time/workspace-calendar";

/**
 * The workspace time zone: the zone OpenPlan uses for "today" and for the
 * dates it stamps on claims, allocations and invoices.
 *
 * The browser's zone is offered as a suggestion only. Nothing is saved until
 * an owner or admin presses Save. The API and the database both check the role
 * and the name.
 */

type WorkspaceTimeZonePanelProps = {
  workspaceId: string;
  canManage: boolean;
  /** The saved setting, or null when none is saved. */
  savedTimeZone: string | null;
  /** The zone in use when the page rendered, and why. */
  effective: WorkspaceCalendar;
  /** The zone that applies with no saved setting. */
  fallback: WorkspaceCalendar;
  /** True when the workspace row could not be read. */
  unreadable: boolean;
  /** True when this installation's database does not have the setting yet. */
  unavailable?: boolean;
};

function zoneList(): string[] {
  try {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return Array.from(new Set(["UTC", ...supported]));
  } catch {
    return ["UTC"];
  }
}

function inUseText(zone: string, source: WorkspaceTimeZoneSource): string {
  if (source === "workspace_setting") return `Dates use ${zone}.`;
  if (source === "home_country") return `Not set. Dates use ${zone}, the only zone in the workspace's country.`;
  return "Not set. Dates use UTC.";
}

export function WorkspaceTimeZonePanel({
  workspaceId,
  canManage,
  savedTimeZone,
  effective,
  fallback,
  unreadable,
  unavailable = false,
}: WorkspaceTimeZonePanelProps) {
  const [saved, setSaved] = useState<string | null>(savedTimeZone);
  const [choice, setChoice] = useState<string>(savedTimeZone ?? "");
  const [suggested, setSuggested] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => {
    const list = zoneList();
    return saved && !list.includes(saved) ? [saved, ...list] : list;
  }, [saved]);

  // Read in an effect: the server renders in UTC, the browser knows better.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat("en-US").resolvedOptions().timeZone;
    if (!browserZone) return;
    setSuggested(browserZone);
    setChoice((current) => current || browserZone);
  }, []);

  const inUse =
    saved === savedTimeZone
      ? inUseText(effective.timeZone, effective.source)
      : saved
        ? inUseText(saved, "workspace_setting")
        : inUseText(fallback.timeZone, fallback.source);

  async function save(next: string | null) {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/home-geography", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, timeZone: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save the time zone");
      setSaved(typeof body.timeZone === "string" ? body.timeZone : null);
      if (!next) setChoice(suggested ?? "");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the time zone");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Time zone">
      <h2 className="text-sm font-semibold text-foreground">Time zone</h2>
      {unavailable ? (
        <p className="mt-2 text-sm text-muted-foreground">Dates use UTC. This setting is not available yet.</p>
      ) : unreadable ? (
        <p className="mt-2 text-sm text-muted-foreground" role="alert">
          The time zone could not be read. Reload to try again.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{inUse}</p>
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-foreground">Zone</span>
                <select
                  className="module-select"
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                  disabled={working}
                >
                  {choice === "" ? <option value="">Choose a zone</option> : null}
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" onClick={() => save(choice || null)} disabled={working || !choice || choice === saved}>
                Save
              </Button>
              {saved ? (
                <Button type="button" variant="outline" onClick={() => save(null)} disabled={working}>
                  Clear
                </Button>
              ) : null}
            </div>
          ) : null}
          {canManage && !saved && suggested && choice === suggested ? (
            <p className="mt-2 text-xs text-muted-foreground">Suggested from this browser. Not saved.</p>
          ) : null}
          {error ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
