import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { EmptyState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export type ModelLinkedRecord = {
  id: string;
  title: string;
  href: string | null;
  statusLabel: string;
  timestampLabel: string;
  meta: string[];
};

export type ModelLinkedRecordSection = {
  title: string;
  count: number;
  emptyCopy: string;
  records: ModelLinkedRecord[];
  /**
   * Why this section's records could not be read, or null when they were.
   *
   * Present because an empty `records` array previously meant two different
   * things — nothing is linked, and the query that would have told us failed —
   * and the section rendered the confident one for both: "0 linked", an "Empty"
   * badge, and copy inviting the planner to go and attach something they may
   * already have attached.
   */
  unavailable?: string | null;
};

const COLUMNS: ReadonlyArray<DataTableColumn<ModelLinkedRecord>> = [
  {
    id: "title",
    header: "Record",
    cell: (row) =>
      row.href ? (
        <Link href={row.href} className="text-sm font-semibold text-foreground hover:text-primary">
          {row.title}
        </Link>
      ) : (
        <span className="text-sm font-semibold text-foreground">{row.title}</span>
      ),
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => (
      <div className="flex flex-col gap-1.5">
        <StatusBadge tone="neutral">{row.statusLabel}</StatusBadge>
        {row.meta.length > 0 ? (
          <MetaList>
            {row.meta.map((item) => (
              <MetaItem key={`${row.id}-${item}`}>{item}</MetaItem>
            ))}
          </MetaList>
        ) : null}
      </div>
    ),
  },
  {
    id: "timestamp",
    header: "Updated",
    align: "right",
    cell: (row) => <span className="text-xs text-muted-foreground">{row.timestampLabel}</span>,
  },
];

export function ModelLinkedRecordsBoard({
  sections,
  totalLinkCount,
  linkSetUnavailable = false,
}: {
  sections: ReadonlyArray<ModelLinkedRecordSection>;
  totalLinkCount: number;
  /**
   * True when the `model_links` read itself failed, so `totalLinkCount` is not
   * a count of anything — it is the length of an array that was never filled.
   */
  linkSetUnavailable?: boolean;
}) {
  // A section that could not be read is a reason to draw the board, not to skip
  // it: collapsing to "No explicit links yet" is precisely the sentence that
  // must not be said when the answer is unknown.
  const hasAnythingToShow = sections.some((section) => section.count > 0 || section.unavailable);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Linked records</p>
          <h2 className="module-section-title">Explicit provenance and outputs</h2>
          <p className="module-section-description">
            Review the linked evidence chain without wading through repetitive empty-state blocks.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <FolderKanban className="h-3.5 w-3.5" />
          {linkSetUnavailable ? "links unreadable" : `${totalLinkCount} explicit links`}
        </span>
      </div>

      {linkSetUnavailable ? (
        <div className="mt-5">
          <EmptyState
            title="This model's links could not be read"
            description="The link set behind this board failed to load, so nothing below is a count of what is attached. Reload the page; if it keeps failing, the records may be readable from the linked plan, report, dataset, or run instead."
          />
        </div>
      ) : !hasAnythingToShow ? (
        <div className="mt-5">
          <EmptyState
            title="No explicit links yet"
            description="Use the Links tab in the control panel to attach supporting scenarios, plans, datasets, reports, recorded runs, or related projects."
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {sections.map((section) => (
            <div key={section.title} className="rounded-[0.5rem] border border-border/70 bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {section.title}
                  </p>
                  <p className="mt-2 text-base font-semibold text-foreground">{section.count} linked</p>
                </div>
                <StatusBadge tone={section.unavailable ? "danger" : section.count > 0 ? "info" : "neutral"}>
                  {section.unavailable ? "Unreadable" : section.count > 0 ? "Active" : "Empty"}
                </StatusBadge>
              </div>

              <div className="mt-4">
                <DataTable<ModelLinkedRecord>
                  columns={COLUMNS}
                  rows={section.records}
                  getRowId={(row) => row.id}
                  density="compact"
                  emptyState={
                    section.unavailable ? (
                      <p className="rounded-[0.5rem] border border-dashed border-destructive/45 bg-destructive/10 p-3 text-sm text-destructive">
                        {section.unavailable}
                      </p>
                    ) : (
                      <p className="rounded-[0.5rem] border border-dashed border-border/60 bg-background/60 p-3 text-sm text-muted-foreground">
                        {section.emptyCopy}
                      </p>
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
