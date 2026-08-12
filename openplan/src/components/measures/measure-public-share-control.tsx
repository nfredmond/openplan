"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, FileText, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PUBLISH THE OVERSIGHT RECORD, and download a year of it.
 *
 * TWO CAPABILITIES IN ONE CARD, on purpose. They are the only two ways anything
 * about this fund leaves the workspace, and an agency deciding to publish is
 * exactly the moment it wants to see what a resident would get. Splitting them
 * into two cards on the same page would be two places to look for "how do
 * people outside see this".
 *
 * WHAT THE COPY MUST NOT SAY. This card is staff-facing and may explain the
 * switch; the words on the PUBLIC page are `MEASURE_OVERSIGHT_COPY` and are
 * written for residents. The one thing said here that matters is that the link
 * itself is the key — an agency that treats the URL as public knowledge and
 * then puts a token in a press release has published the page whether or not it
 * meant to, and the sentence below is the only warning it gets.
 *
 * NO REGENERATE BUTTON. The route has no rotate path (see its header), so this
 * card offers none. Turning the page off and on again returns the SAME link, so
 * a printed agenda keeps working — which is the behaviour an agency wants and
 * the opposite of what a "regenerate" control beside a toggle would produce.
 */
export function MeasurePublicShareControl({
  measureId,
  initialEnabled,
  initialToken,
  fiscalYearLabels,
  canWrite,
}: {
  measureId: string;
  initialEnabled: boolean;
  initialToken: string | null;
  /** The years a statement can be produced for, newest first. */
  fiscalYearLabels: readonly string[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [token, setToken] = useState(initialToken);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statementYear, setStatementYear] = useState(fiscalYearLabels[0] ?? "");

  const publicPath = token ? `/measure/${token}` : null;
  const publicUrl =
    publicPath && typeof window !== "undefined" ? `${window.location.origin}${publicPath}` : publicPath;

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/measures/${measureId}/public-share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = (await response.json()) as {
        error?: string;
        details?: string;
        enabled?: boolean;
        token?: string | null;
      };
      if (!response.ok) throw new Error(payload.details || payload.error || "Failed to update public sharing");
      setEnabled(Boolean(payload.enabled));
      if (payload.token) setToken(payload.token);
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update public sharing");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select and copy the link manually.");
    }
  }

  const statementHref = statementYear
    ? `/api/measures/${measureId}/statement?fiscalYearLabel=${encodeURIComponent(statementYear)}`
    : null;

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold text-foreground">The oversight record</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A read-only page for residents and the oversight committee: what the fund has received, what the
              ordinance says it must pay for, and who has claimed against it. Off until you turn it on.
            </p>
          </div>
        </div>
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            variant={enabled ? "outline" : "default"}
            onClick={() => void toggle(!enabled)}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {enabled ? "Take it down" : "Publish the oversight page"}
          </Button>
        ) : null}
      </div>

      {enabled && publicUrl ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2">
            <a
              href={publicPath ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-xs text-foreground underline-offset-2 hover:underline"
            >
              {publicUrl}
            </a>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Anyone with this link can read the page — it is the key, and there is no sign-in in front of it.
            Search engines are asked not to index it. Taking the page down keeps the same link for next time.
          </p>
        </>
      ) : null}

      {!enabled ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing about this measure is visible outside the workspace right now.
        </p>
      ) : null}

      <div className="mt-4 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            <span className="mb-1 block font-medium text-foreground">Annual statement</span>
            <select
              value={statementYear}
              onChange={(event) => setStatementYear(event.target.value)}
              disabled={fiscalYearLabels.length === 0}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Fiscal year for the annual statement"
            >
              {fiscalYearLabels.length === 0 ? <option value="">No year has periods yet</option> : null}
              {fiscalYearLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {statementHref ? (
            <a
              href={statementHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              <FileText className="h-4 w-4" />
              Open the statement
            </a>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          One year of this fund as a printable page. It says which reporting periods it has and which are still
          unreported — it is not an audited financial statement.
        </p>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </section>
  );
}
