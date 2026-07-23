// Presentational only — the public page loads published close-loop entries with
// the service-role client (campaign-scoped) and passes them in. No client fetch.

export type PublicCloseLoopEntry = {
  id: string;
  themeTitle: string;
  youSaid: string;
  weDid: string;
  categoryLabel: string | null;
};

export function PublicCloseLoop({ entries }: { entries: PublicCloseLoopEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="public-success-state text-sm text-muted-foreground">
        The project team has not published any updates for this campaign yet.
      </div>
    );
  }

  return (
    <div className="public-ledger">
      {entries.map((entry) => (
        <article key={entry.id} className="public-ledger-row">
          <div className="public-ledger-body">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="public-ledger-title">{entry.themeTitle}</h3>
              {entry.categoryLabel ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{entry.categoryLabel}</span>
              ) : null}
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">You said</p>
                <p className="public-ledger-copy whitespace-pre-line">{entry.youSaid || "—"}</p>
              </div>
              <div>
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">We did</p>
                <p className="public-ledger-copy whitespace-pre-line">{entry.weDid || "—"}</p>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
