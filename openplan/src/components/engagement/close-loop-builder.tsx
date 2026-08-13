"use client";

import { useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CloseLoopEntryRow, CloseLoopStatus } from "@/lib/engagement/close-loop";

const LABEL_CLASS = "text-[0.82rem] font-semibold text-foreground";
const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const ERROR_CLASS =
  "rounded-[0.5rem] border border-red-300/80 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";

const NOTICE_CLASS =
  "rounded-[0.5rem] border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground";
const NOTICE_WARNING_CLASS =
  "rounded-[0.5rem] border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200";

type Category = { id: string; label: string };

/**
 * What the PATCH route reports about the subscriber broadcast a publish owed.
 * `outcome: null` means this PATCH was not a draft->published transition, so no
 * broadcast was owed and there is nothing to say.
 */
type BroadcastResult = { enqueued: number; delivered: number; skipped: number; failed: number; transport: string };
type BroadcastReport = { outcome: "attempted" | "no_share_token" | "unknown" | null; result: BroadcastResult | null };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Turn the route's broadcast report into sentences an operator can act on.
 *
 * The distinctions here are the whole point of the panel: "nobody is subscribed",
 * "queued but this deployment cannot send email", "the provider refused" and "we
 * do not know" are four different facts, and the enqueue count alone conflates
 * all of them. `unknown` is never rendered as "nobody was emailed" — a step that
 * did not report back is not evidence that no one was reached.
 *
 * KNOWN GAP, and the reason the zero branch below hedges. A FIFTH fact — "the
 * subscriber list could not be read" — has no representation in this payload:
 * `enqueueCampaignSubscriberEmails` (src/lib/notifications/engagement.ts) selects
 * from the engagement_subscriptions table destructuring only `data`, and drops
 * the error, so a permission or connectivity failure arrives here as
 * `enqueued: 0`. Verified 2026-08-04 by calling it with a client that answers
 * `{ data: null, error }`: the result is `{ enqueued: 0, … }`, byte-identical to
 * a campaign nobody subscribed to. The durable fix belongs in that lib (report
 * the read failure alongside the counts and give this function a
 * `subscribers_unreadable` outcome); until then this component may only say what
 * OpenPlan FOUND, never what is true.
 */
export function describeBroadcast(report: BroadcastReport): { tone: "neutral" | "warning"; lines: string[] } | null {
  if (!report.outcome) return null;

  if (report.outcome === "no_share_token") {
    return {
      tone: "warning",
      lines: [
        "No update emails were sent: this campaign has no public share link, so there is no working unsubscribe link to put in them.",
        "Publish the share link first if you want subscribers notified of future updates.",
      ],
    };
  }

  if (report.outcome === "unknown" || !report.result) {
    return {
      tone: "warning",
      lines: [
        "The entry was published, but OpenPlan could not determine whether subscriber update emails were queued — the notification step did not report back.",
        "This is not the same as nobody being emailed. Check Activity → Email delivery for what actually reached the outbox.",
      ],
    };
  }

  const { enqueued, delivered, skipped, failed, transport } = report.result;

  // A zero here is NOT evidence that nobody subscribed.
  // enqueueCampaignSubscriberEmails() reads engagement_subscriptions with the
  // error discarded, so a subscriber list that could not be read arrives as an
  // empty one and lands in this exact branch. Until that read reports its own
  // failure (see the note above describeBroadcast), this branch may report what
  // OpenPlan FOUND and must not assert what is TRUE of the world.
  if (enqueued === 0) {
    return {
      tone: "neutral",
      lines: [
        "No update emails were queued: OpenPlan found no confirmed email subscriptions for this campaign.",
        "If you know people have subscribed, tell whoever runs this deployment — OpenPlan cannot yet tell an empty subscriber list apart from one it failed to read, so this is “none found”, not a confirmed count.",
      ],
    };
  }

  const lines: string[] = [];
  if (delivered > 0) lines.push(`${plural(delivered, "update email", "update emails")} delivered via ${transport}.`);
  if (skipped > 0) {
    lines.push(
      `${plural(skipped, "update email was", "update emails were")} recorded in the outbox but not delivered — this deployment has no email service configured (transport: ${transport}).`
    );
  }
  if (failed > 0) {
    lines.push(
      `${plural(failed, "update email", "update emails")} could not be delivered — the email service refused them. See Activity → Email delivery for the reason.`
    );
  }
  return { tone: delivered === enqueued ? "neutral" : "warning", lines };
}

type Draft = { themeTitle: string; youSaid: string; sourceItemIds: string[] };
type DraftResponse = {
  drafts: Draft[];
  source: "ai" | "deterministic-fallback";
  model: string | null;
  fallbackReason: string | null;
  itemCount: number;
  caveat: string;
};

async function api(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) || `Request failed (${res.status})`);
  return payload;
}

function CloseLoopCard({
  campaignId,
  entry,
  categories,
  onUpdate,
  onRemove,
}: {
  campaignId: string;
  entry: CloseLoopEntryRow;
  categories: Category[];
  onUpdate: (next: CloseLoopEntryRow) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [themeTitle, setThemeTitle] = useState(entry.theme_title);
  const [youSaid, setYouSaid] = useState(entry.you_said);
  const [weDid, setWeDid] = useState(entry.we_did);
  const [categoryId, setCategoryId] = useState(entry.category_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broadcast, setBroadcast] = useState<BroadcastReport | null>(null);

  const categoryLabel = entry.category_id ? categories.find((c) => c.id === entry.category_id)?.label ?? null : null;
  const broadcastNotice = broadcast ? describeBroadcast(broadcast) : null;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const payload = await api(`/api/engagement/campaigns/${campaignId}/closeloop/${entry.id}`, "PATCH", body);
      onUpdate(payload.entry as CloseLoopEntryRow);
      // Publishing broadcasts to confirmed subscribers. The route now reports
      // what became of that; anything else (an edit, an unpublish) reports a
      // null outcome and clears whatever the last publish said.
      setBroadcast({
        outcome: (payload.broadcastOutcome as BroadcastReport["outcome"]) ?? null,
        result: (payload.broadcast as BroadcastResult | null) ?? null,
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const ok = await patch({
      themeTitle: themeTitle.trim(),
      youSaid: youSaid.trim(),
      weDid: weDid.trim(),
      categoryId: categoryId || null,
    });
    if (ok) setEditing(false);
  }

  async function togglePublish() {
    const next: CloseLoopStatus = entry.status === "published" ? "draft" : "published";
    await patch({ status: next });
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/engagement/campaigns/${campaignId}/closeloop/${entry.id}`, "DELETE");
      onRemove(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="module-record-row">
      <div className="module-record-kicker">
        <StatusBadge tone={entry.status === "published" ? "success" : "neutral"}>
          {entry.status === "published" ? "Published" : "Draft"}
        </StatusBadge>
        {categoryLabel ? <StatusBadge tone="info">{categoryLabel}</StatusBadge> : null}
        {entry.ai_assisted ? <StatusBadge tone="warning">AI-assisted draft</StatusBadge> : null}
      </div>

      {editing ? (
        <div className="mt-2 space-y-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Theme</span>
            <Input value={themeTitle} onChange={(e) => setThemeTitle(e.target.value)} maxLength={200} />
          </label>
          {categories.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Theme tag (optional)</span>
              <select className={SELECT_CLASS} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">No tag</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>You said</span>
            <Textarea value={youSaid} onChange={(e) => setYouSaid(e.target.value)} rows={3} placeholder="What the community told us" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>We did</span>
            <Textarea value={weDid} onChange={(e) => setWeDid(e.target.value)} rows={3} placeholder="How the project team responded" />
          </label>
          {error ? <p className={ERROR_CLASS}>{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()} disabled={busy || !themeTitle.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 space-y-2">
          <p className="font-medium text-foreground">{entry.theme_title}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">You said</p>
              <p className="text-sm text-foreground">{entry.you_said || <span className="text-muted-foreground">—</span>}</p>
            </div>
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">We did</p>
              <p className="text-sm text-foreground">{entry.we_did || <span className="text-muted-foreground">—</span>}</p>
            </div>
          </div>
          {entry.status === "published" && !entry.we_did.trim() ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Published with no “we did” response yet — the public sees only what was heard.
            </p>
          ) : null}
          {error ? <p className={ERROR_CLASS}>{error}</p> : null}
          {/*
            The anchor carries the entry id, and is what the campaign console's
            Setup tab claims through its `closeloop-broadcast-notice-` prefix.
            Per-entry rather than bare because this card is rendered once for
            every close-the-loop entry; a bare, unsuffixed
            closeloop-broadcast-notice would repeat down the page as soon
            as a second entry was published, and a duplicated id sends every
            deep link to whichever copy comes first. `data-testid` stays bare on
            purpose — it is not an anchor, and nothing resolves a fragment
            through it.
          */}
          {broadcastNotice ? (
            <div
              className={broadcastNotice.tone === "warning" ? NOTICE_WARNING_CLASS : NOTICE_CLASS}
              id={`closeloop-broadcast-notice-${entry.id}`}
              data-testid="closeloop-broadcast-notice"
            >
              <p className="font-semibold">Subscriber update emails</p>
              {broadcastNotice.lines.map((line) => (
                <p key={line} className="mt-1">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void togglePublish()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {entry.status === "published" ? "Unpublish" : "Publish"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} disabled={busy} aria-label="Delete entry">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EngagementCloseLoopBuilder({
  campaignId,
  categories,
  initialEntries,
}: {
  campaignId: string;
  categories: Category[];
  initialEntries: CloseLoopEntryRow[];
}) {
  const [entries, setEntries] = useState<CloseLoopEntryRow[]>(initialEntries);
  const [themeTitle, setThemeTitle] = useState("");
  const [youSaid, setYouSaid] = useState("");
  const [weDid, setWeDid] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI draft-assist state.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftMeta, setDraftMeta] = useState<Omit<DraftResponse, "drafts"> | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const publishedCount = entries.filter((e) => e.status === "published").length;

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!themeTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await api(`/api/engagement/campaigns/${campaignId}/closeloop`, "POST", {
        themeTitle: themeTitle.trim(),
        youSaid: youSaid.trim() || undefined,
        weDid: weDid.trim() || undefined,
        categoryId: categoryId || undefined,
        sortOrder: entries.length,
      });
      setEntries((prev) => [...prev, payload.entry as CloseLoopEntryRow]);
      setThemeTitle("");
      setYouSaid("");
      setWeDid("");
      setCategoryId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    } finally {
      setBusy(false);
    }
  }

  async function generateDrafts() {
    setDraftLoading(true);
    setDraftError(null);
    try {
      const payload = (await api(`/api/engagement/campaigns/${campaignId}/closeloop/draft`, "POST", {})) as unknown as DraftResponse;
      setDrafts(payload.drafts ?? []);
      setDraftMeta({
        source: payload.source,
        model: payload.model,
        fallbackReason: payload.fallbackReason,
        itemCount: payload.itemCount,
        caveat: payload.caveat,
      });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to generate drafts");
    } finally {
      setDraftLoading(false);
    }
  }

  async function addDraft(draft: Draft) {
    setBusy(true);
    setError(null);
    try {
      const payload = await api(`/api/engagement/campaigns/${campaignId}/closeloop`, "POST", {
        themeTitle: draft.themeTitle,
        youSaid: draft.youSaid || undefined,
        sourceItemIds: draft.sourceItemIds.length ? draft.sourceItemIds : undefined,
        aiAssisted: true,
        sortOrder: entries.length,
      });
      setEntries((prev) => [...prev, payload.entry as CloseLoopEntryRow]);
      setDrafts((prev) => prev.filter((d) => d !== draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add draft entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Close the loop</p>
          <h2 className="module-section-title">You said / We did</h2>
          <p className="module-section-description">
            Publish what the community told you and how the project team responded. {publishedCount} published, {entries.length} total.
            Drafts stay private until you publish them.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet. Draft from community input or add one below.</p>
        ) : (
          entries.map((entry) => (
            <CloseLoopCard
              key={entry.id}
              campaignId={campaignId}
              entry={entry}
              categories={categories}
              onUpdate={(next) => setEntries((prev) => prev.map((e) => (e.id === next.id ? next : e)))}
              onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
            />
          ))
        )}
      </div>

      {/* AI draft-assist — seeds "you said" from approved input; never auto-publishes. */}
      <div className="mt-6 space-y-3 border-t border-border/60 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={LABEL_CLASS}>Draft from community input</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void generateDrafts()} disabled={draftLoading}>
            {draftLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate drafts
          </Button>
        </div>
        {draftMeta ? (
          <p className="text-xs text-muted-foreground">
            {draftMeta.source === "ai"
              ? `AI-drafted from ${draftMeta.itemCount} approved item${draftMeta.itemCount === 1 ? "" : "s"}${draftMeta.model ? ` (${draftMeta.model})` : ""}. Review and edit before publishing.`
              : `AI is offline${draftMeta.fallbackReason ? ` (${draftMeta.fallbackReason})` : ""} — grouped ${draftMeta.itemCount} approved item${draftMeta.itemCount === 1 ? "" : "s"} by theme instead. Review and edit before publishing.`}
          </p>
        ) : null}
        {draftError ? <p className={ERROR_CLASS}>{draftError}</p> : null}
        {drafts.length > 0 ? (
          <div className="space-y-2">
            {drafts.map((draft, index) => (
              <div key={index} className="rounded-lg border border-border/60 p-3">
                <p className="font-medium text-foreground">{draft.themeTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{draft.youSaid}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void addDraft(draft)} disabled={busy}>
                  <Plus className="h-4 w-4" /> Add as draft entry
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Manual add. */}
      <form onSubmit={addEntry} className="mt-6 space-y-3 border-t border-border/60 pt-5">
        <p className={LABEL_CLASS}>Add an entry</p>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Theme</span>
          <Input value={themeTitle} onChange={(e) => setThemeTitle(e.target.value)} maxLength={200} placeholder="e.g. Safer crossings downtown" />
        </label>
        {categories.length > 0 ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Theme tag (optional)</span>
            <select className={SELECT_CLASS} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No tag</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">You said</span>
          <Textarea value={youSaid} onChange={(e) => setYouSaid(e.target.value)} rows={2} placeholder="What the community told us" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">We did</span>
          <Textarea value={weDid} onChange={(e) => setWeDid(e.target.value)} rows={2} placeholder="How the project team responded" />
        </label>
        {error ? <p className={ERROR_CLASS}>{error}</p> : null}
        <Button type="submit" disabled={busy || !themeTitle.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add entry
        </Button>
      </form>
    </article>
  );
}
