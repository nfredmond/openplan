import Link from "next/link";

export type ReportPacketCommandQueueItem = {
  key: string;
  href: string;
  title: string;
  subtitle?: string | null;
  detail: string;
  badges?: Array<{
    label: string;
    value?: string | number | null;
  }>;
};

export function ReportPacketCommandQueue({
  title,
  description,
  items,
  emptyLabel = "No queued packet work.",
}: {
  title: string;
  description: string;
  items: ReportPacketCommandQueueItem[];
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="module-record-chip">
          <span>Queued</span>
          <strong>{items.length}</strong>
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="block rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  {item.subtitle ? (
                    <p className="mt-1 text-xs text-muted-foreground">{item.subtitle}</p>
                  ) : null}
                </div>
                {item.badges && item.badges.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {item.badges.map((badge, index) => (
                      <span key={`${item.key}-badge-${index}`} className="module-record-chip">
                        <span>{badge.label}</span>
                        {badge.value !== null && badge.value !== undefined ? <strong>{badge.value}</strong> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
