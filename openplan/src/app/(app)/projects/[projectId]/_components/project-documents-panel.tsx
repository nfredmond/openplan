import { FolderOpen } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/ui/status";
import { DOCUMENT_LIBRARY_SOURCES, type DocumentLibrarySource } from "@/lib/document-library/sources";
import {
  describeDocumentLibraryOrdering,
  type DocumentLibraryBadgeTone,
  type DocumentLibraryEntry,
  type DocumentLibraryResult,
  type DocumentSourceOutcome,
} from "@/lib/document-library/types";
import { fmtDateTime } from "./_helpers";
import { ProjectEvidenceBundlePanel } from "./project-evidence-bundle-panel";

/**
 * The project's slice of the Document Library: every file OpenPlan holds or
 * can produce for this project, grouped by the module that owns it.
 *
 * This panel is a READER of the library result and nothing else. Three
 * contracts it keeps, all inherited from the library's own shape:
 *
 * - Read-failure ≠ empty, PER SOURCE. A source whose read failed (or whose
 *   table this deployment does not have yet) renders its own sentence in the
 *   group where its files would be — it is never dropped, and its emptiness is
 *   never presented as "no files".
 * - Every link is an app ROUTE (`entry.downloadHref`), never a storage URL —
 *   two of the sources carry member-writable or untrusted path columns, and
 *   the routes re-verify scope on every dereference.
 * - The merged listing is per-source CAPPED, so the panel labels it with the
 *   library's own ordering sentence and never presents a total as a complete
 *   inventory.
 */
type ProjectDocumentsPanelProps = {
  library: DocumentLibraryResult;
  projectId: string;
  canGenerateEvidenceBundle: boolean;
};

/** The library's badge tones, mapped onto the app-wide StatusBadge vocabulary. */
const BADGE_TONES: Record<DocumentLibraryBadgeTone, StatusTone> = {
  positive: "success",
  neutral: "neutral",
  warning: "warning",
  critical: "danger",
};

/**
 * Bytes as a planner reads them. Whole units, no false precision — the number
 * exists so a 300 KB letter and a 2 GB point cloud are tellable apart.
 */
function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** One source's group: its descriptor, its read outcome, and the rows it contributed. */
type SourceGroup = {
  source: DocumentLibrarySource;
  outcome: DocumentSourceOutcome;
  entries: DocumentLibraryEntry[];
};

function entryRow(entry: DocumentLibraryEntry) {
  const meta = [
    entry.createdAt ? fmtDateTime(entry.createdAt) : null,
    entry.byteSize !== null ? formatByteSize(entry.byteSize) : null,
  ].filter(Boolean);
  return (
    <div key={`${entry.sourceId}:${entry.id}`} className="module-record-row">
      <div className="module-record-main">
        <div className="module-record-kicker">
          <StatusBadge tone={BADGE_TONES[entry.badge.tone]}>{entry.badge.label}</StatusBadge>
        </div>
        <div className="space-y-1.5">
          <h4 className="module-record-title">
            {entry.downloadHref ? (
              <a
                href={entry.downloadHref}
                className="underline decoration-dotted underline-offset-2 transition hover:text-foreground"
              >
                {entry.title}
              </a>
            ) : (
              entry.title
            )}
          </h4>
          {entry.detail ? <p className="module-record-summary">{entry.detail}</p> : null}
          {meta.length > 0 ? (
            <p className="text-[0.73rem] text-muted-foreground">{meta.join(" · ")}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function sourceGroupBlock({ source, outcome, entries }: SourceGroup) {
  return (
    <div key={source.id} className="space-y-2">
      <p className="module-section-label">
        {source.label}
        {outcome.pending || outcome.failed ? null : ` · ${outcome.count}`}
      </p>
      {outcome.pending ? (
        <p className="module-empty-state text-sm">
          This deployment&apos;s database does not carry {source.readLabel} yet — apply the pending
          migration, then reload. Until then this group is unavailable, not empty.
        </p>
      ) : outcome.failed ? (
        <p className="module-empty-state text-sm">
          This project&apos;s {source.readLabel} could not be read, so this group is unavailable
          rather than empty — this is not a finding that no files exist. Reload; if it persists, an
          operator can act on the database&apos;s message below.
        </p>
      ) : (
        <div className="module-record-list">{entries.map(entryRow)}</div>
      )}
    </div>
  );
}

export function ProjectDocumentsPanel({ library, projectId, canGenerateEvidenceBundle }: ProjectDocumentsPanelProps) {
  // Canonical source order comes from the library, not this panel. A source is
  // shown when it contributed files OR when its read could not answer — a
  // failed source hidden from the shelf is the read-failure-as-absence defect
  // wearing a layout decision. Sources that answered "genuinely nothing" stay
  // off the shelf so seven mostly-empty groups do not bury the real files.
  const groups: SourceGroup[] = DOCUMENT_LIBRARY_SOURCES.flatMap((source) => {
    const outcome = library.perSource[source.id];
    if (!outcome) return [];
    const entries = library.entries.filter((entry) => entry.sourceId === source.id);
    if (entries.length === 0 && !outcome.failed && !outcome.pending) return [];
    return [{ source, outcome, entries }];
  });
  const shownFileCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const failureMessages = library.reads.messages();

  return (
    <article id="project-documents" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Documents</p>
            <h2 className="module-section-title">Files on this project&apos;s record</h2>
          </div>
        </div>
        <Link
          href={`/knowledge-base?projectId=${projectId}`}
          className="text-sm underline decoration-dotted underline-offset-2 transition hover:text-foreground"
        >
          Open in the document library
        </Link>
      </div>

      <div className="mt-5">
        <ProjectEvidenceBundlePanel projectId={projectId} canGenerate={canGenerateEvidenceBundle} />
      </div>

      {groups.length === 0 ? (
        <div className="module-empty-state mt-5 text-sm">
          No files are attached to this project yet. Reports, grant application exports, invoices,
          aerial deliverables, and model outputs will appear here as their modules produce them —
          or attach plans, letters, and studies directly in the Knowledge Base.
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {shownFileCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {describeDocumentLibraryOrdering(library.limitPerSource)}
            </p>
          ) : null}
          {groups.map(sourceGroupBlock)}
          {failureMessages.length > 0 ? (
            <p className="text-[0.73rem] text-muted-foreground">{failureMessages.join(" · ")}</p>
          ) : null}
        </div>
      )}
    </article>
  );
}
