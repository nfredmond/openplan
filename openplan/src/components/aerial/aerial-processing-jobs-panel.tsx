import { AlertTriangle } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { AerialCustodyRetry } from "@/components/aerial/aerial-custody-retry";
import {
  summarizeAerialArtifactCustody,
  type AerialArtifactCustodyRecord,
} from "@/lib/aerial/artifact-custody";
import {
  AERIAL_PROCESSING_ARTIFACT_CUSTODY_NOTE,
  describeAerialImagerySourceHost,
  formatArtifactKindLabel,
  readAerialProcessingArtifacts,
  type AerialProcessingJobSummary,
} from "@/lib/aerial/catalog";
import type { AerialProcessingJobRow } from "@/lib/aerial/queries";
import { formatFileSize } from "@/lib/models/evidence-packet";

/**
 * The mission page's view of `aerial_processing_jobs`.
 *
 * WHAT THIS FIXES. Every column below has been written since migration
 * 20260721000001 and read back by nothing. A planner who dispatched a flight for
 * processing opened the mission page and saw no trace of it — not that it was
 * running, not what it produced, not that it had failed with a recorded reason.
 *
 * THREE CLAIM BOUNDARIES THIS COMPONENT HOLDS.
 *
 *  1. A job that stopped reporting is not a job that stopped. OpenPlan never
 *     polls the worker; it only receives callbacks. So the silent verdict says
 *     "stopped reporting", names how long the silence has lasted, and states
 *     outright that the work may still be running on the worker. It never
 *     invents a completion it cannot observe.
 *
 *  2. The output list is vendor JSON; what is DOWNLOADABLE is what custody
 *     holds. The list renders the worker's descriptors as metadata (kinds,
 *     sizes, link expiries — never the worker's URL, which is a credential),
 *     and the custody section renders a download control for exactly the
 *     artifacts whose bytes sit in OpenPlan's own bucket. A held artifact is
 *     downloadable after the worker's link lapses; a not-held one is never
 *     presented as if it were.
 *
 *  3. Nothing is normalized away. An artifact kind this build does not know is
 *     printed as itself; entries the reader could not parse are COUNTED and
 *     disclosed rather than dropped.
 *
 * Server component: it renders on the same request as the page, so what it
 * shows is exactly what the database answered.
 */

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ProgressMeter({ percent }: { percent: number }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Reported processing progress"
    >
      <div
        className="h-full rounded-full bg-[color:var(--accent)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function JobIdentifiers({ job }: { job: AerialProcessingJobRow }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-1 text-[0.68rem] text-muted-foreground sm:grid-cols-2">
      <div className="flex gap-1.5">
        <dt className="font-medium">Request id</dt>
        <dd className="font-mono break-all">{job.request_id}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-medium">Worker job</dt>
        <dd className="font-mono break-all">{job.job_reference ?? "not assigned"}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-medium">Last callback</dt>
        <dd>
          {job.last_callback_at ? formatTimestamp(job.last_callback_at) : "none received"}
          {job.last_callback_id ? <span className="font-mono"> · {job.last_callback_id}</span> : null}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-medium">Requested</dt>
        <dd>{formatTimestamp(job.created_at)}</dd>
      </div>
    </dl>
  );
}

function ImagerySubmitted({ job }: { job: AerialProcessingJobRow }) {
  const host = describeAerialImagerySourceHost(job.imagery_url);
  const size = formatFileSize(job.imagery_size_bytes);
  const parts: string[] = [];
  if (typeof job.imagery_image_count === "number") {
    parts.push(`${job.imagery_image_count} image${job.imagery_image_count === 1 ? "" : "s"}`);
  }
  if (size) parts.push(size);
  if (host) parts.push(`from ${host}`);
  if (job.preset_id) parts.push(`${job.preset_id} preset`);

  if (parts.length === 0) return null;

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Imagery submitted:</span> {parts.join(" · ")}
      {host ? (
        <span className="block text-[0.68rem]">
          Only the host is shown — the imagery link is a signed URL supplied at request time.
        </span>
      ) : null}
    </p>
  );
}

function ArtifactList({
  job,
  now,
  custody,
  custodyUnreadableReason,
}: {
  job: AerialProcessingJobRow;
  now: Date;
  custody: AerialArtifactCustodyRecord[];
  custodyUnreadableReason: string | null;
}) {
  const reading = readAerialProcessingArtifacts(job.artifacts, now);

  // A held custody row is downloadable whatever shape the vendor JSON is in —
  // the bytes live in OpenPlan's own bucket. So the custody section renders
  // beside every branch below, including the malformed one: bytes this
  // deployment holds must never be hidden by a vendor descriptor it cannot read.
  const custodySection = (
    <CustodyNote job={job} custody={custody} unreadableReason={custodyUnreadableReason} />
  );
  const hasCustodyFacts = custody.length > 0 || custodyUnreadableReason !== null;

  if (reading.malformed) {
    return (
      <div className="mt-3">
        <StateBlock
          compact
          tone="warning"
          title="The recorded outputs could not be read"
          description="This job's artifacts column holds something that is not a list of artifacts. The worker reported outputs, but OpenPlan cannot describe them — treat this as unknown, not as none."
        />
        {hasCustodyFacts ? custodySection : null}
      </div>
    );
  }

  if (!reading.recorded) {
    return hasCustodyFacts ? <div className="mt-3">{custodySection}</div> : null;
  }

  if (reading.entries.length === 0 && reading.unreadableEntryCount === 0) {
    return (
      <div className="mt-3">
        <p className="text-xs text-muted-foreground">
          The worker recorded an empty output list for this job.
        </p>
        {hasCustodyFacts ? custodySection : null}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Outputs the worker reported
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {reading.entries.map((entry, index) => (
          <li
            key={`${entry.kind}-${index}`}
            className="rounded-[0.4rem] border border-[color:var(--line)] bg-background/60 px-2.5 py-2 text-xs"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">{entry.kindLabel}</span>
              {entry.sizeBytes !== null ? (
                <span className="text-muted-foreground">{formatFileSize(entry.sizeBytes)}</span>
              ) : null}
              {entry.contentType ? (
                <span className="font-mono text-[0.66rem] text-muted-foreground">{entry.contentType}</span>
              ) : null}
            </div>
            <p className="mt-1 text-[0.68rem] text-muted-foreground">
              {entry.expired === true ? (
                <>Worker link expired {formatTimestamp(entry.expiresAt)}.</>
              ) : entry.expired === false ? (
                <>Worker link expires {formatTimestamp(entry.expiresAt)}.</>
              ) : entry.downloadUrl ? (
                <>The worker gave a link with no usable expiry, so whether it still works is unknown.</>
              ) : (
                <>The worker reported this output without a download link.</>
              )}{" "}
              Whether OpenPlan holds its own copy is stated below.
            </p>
          </li>
        ))}
      </ul>
      {reading.unreadableEntryCount > 0 ? (
        <p className="mt-1.5 text-[0.68rem] text-[color:var(--copper)]">
          {reading.unreadableEntryCount} further output
          {reading.unreadableEntryCount === 1 ? " was" : "s were"} recorded in a shape OpenPlan could not
          read, and {reading.unreadableEntryCount === 1 ? "is" : "are"} not listed above.
        </p>
      ) : null}
      {custodySection}
    </div>
  );
}

/**
 * One download control per artifact OpenPlan actually holds.
 *
 * WHY THESE LINKS AND NOT THE WORKER'S. The panel used to render "Download from
 * the processing worker" against `entry.downloadUrl` — a branch that had been
 * dead since `redactArtifactDescriptors` began stripping worker URLs from the
 * job row (they are bearer credentials and the column is member-readable). So
 * custody was write-only: sha256-verified bytes sat in the private bucket and
 * NO surface could hand them back. This list is the read half. Each control
 * goes through the authed download route, which verifies membership and the
 * row's own scope before minting a short-lived signed URL.
 *
 * Only `held` rows get a control — the others have no bytes behind them, and
 * their recorded reasons are already in the custody sentence above this list.
 */
function HeldArtifactDownloads({
  job,
  custody,
}: {
  job: AerialProcessingJobRow;
  custody: AerialArtifactCustodyRecord[];
}) {
  const held = custody.filter(
    (record) => record.state === "held" && typeof record.id === "string" && record.id.length > 0
  );
  if (held.length === 0) return null;

  return (
    <ul className="mt-1.5 space-y-1">
      {held.map((record) => (
        <li
          key={record.id}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[0.68rem]"
        >
          <a
            className="font-medium text-sky-600 underline dark:text-sky-400"
            href={`/api/aerial/processing-jobs/${job.id}/artifacts/${record.id}/download`}
          >
            Download {formatArtifactKindLabel(record.kind).toLowerCase()}
            {record.ordinal > 0 ? ` (${record.ordinal + 1})` : ""}
          </a>
          {record.byte_size !== null ? (
            <span className="text-muted-foreground">{formatFileSize(record.byte_size)}</span>
          ) : null}
          {record.checksum_sha256 ? (
            <span className="font-mono text-muted-foreground">
              SHA-256 {record.checksum_sha256.slice(0, 12)}…
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}


/**
 * WHAT OPENPLAN ACTUALLY HOLDS FOR THIS JOB — three different facts, kept apart.
 *
 * This replaced a single standing sentence that said "OpenPlan records the list,
 * not the files". That was true when written and became FALSE the moment custody
 * began downloading bytes into a private bucket — and it was rendered on every
 * job regardless. Both directions of that error are serious: telling an agency
 * its deliverables are perishable when they are held wastes a re-flight, and
 * telling it they are held when the link has lapsed loses the evidence under a
 * decision.
 *
 * A ledger that could not be READ is its own third answer. "Nothing is held" and
 * "we could not find out what is held" send an operator to different places, and
 * only one of them is a statement about this job.
 */
function CustodyNote({
  job,
  custody,
  unreadableReason,
}: {
  job: AerialProcessingJobRow;
  custody: AerialArtifactCustodyRecord[];
  unreadableReason: string | null;
}) {
  if (unreadableReason) {
    return (
      <p className="mt-1.5 text-[0.68rem] text-[color:var(--copper)]">
        OpenPlan could not read its own record of which of these outputs it holds, so whether they
        survive the worker&apos;s links expiring is unestablished — this is not a finding that none are
        held. ({unreadableReason})
      </p>
    );
  }

  const posture = summarizeAerialArtifactCustody(custody);

  if (posture.state === "not_applicable") {
    // No ledger rows: nothing has been taken, so the original sentence is still
    // exactly true for this job.
    return (
      <p className="mt-1.5 text-[0.68rem] text-muted-foreground">
        {AERIAL_PROCESSING_ARTIFACT_CUSTODY_NOTE}
      </p>
    );
  }

  return (
    <div data-testid={`aerial-custody-${job.id}`}>
      <p
        className={
          posture.state === "complete"
            ? "mt-1.5 text-[0.68rem] text-muted-foreground"
            : "mt-1.5 text-[0.68rem] text-[color:var(--copper)]"
        }
      >
        {posture.detail}
      </p>
      {/* The read half of custody: a control per artifact OpenPlan holds. */}
      <HeldArtifactDownloads job={job} custody={custody} />
      {/* Offered only when something is still saveable — see the component. */}
      <AerialCustodyRetry processingJobId={job.id} recoverableCount={posture.recoverableCount} />
    </div>
  );
}

function BenchmarkSummary({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return null;
  }
  if (!serialized || serialized === "{}") return null;

  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Worker benchmark summary — vendor JSON, schema owned by the processing platform
      </summary>
      <pre className="mt-1.5 max-h-64 overflow-auto rounded-[0.4rem] border border-[color:var(--line)] bg-background/60 p-2 text-[0.66rem] leading-relaxed">
        {serialized}
      </pre>
    </details>
  );
}

export function AerialProcessingJobCard({
  job,
  summary,
  now,
  custody = [],
  custodyUnreadableReason = null,
}: {
  job: AerialProcessingJobRow;
  summary: AerialProcessingJobSummary;
  now: Date;
  /** What OpenPlan holds for THIS job. Empty means nothing taken, which the note says plainly. */
  custody?: AerialArtifactCustodyRecord[];
  /** Set when the ledger could not be read — a different fact from nothing held. */
  custodyUnreadableReason?: string | null;
}) {
  return (
    <article className="rounded-[0.5rem] border border-[color:var(--line)] bg-background/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={summary.statusTone}>{summary.statusLabel}</StatusBadge>
        <StatusBadge tone={summary.livenessTone}>{summary.livenessLabel}</StatusBadge>
        {summary.progressLabel ? (
          <span className="text-xs text-muted-foreground">{summary.progressLabel}</span>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{summary.livenessDetail}</p>

      {summary.progressPercent !== null ? (
        <div className="mt-2">
          <ProgressMeter percent={summary.progressPercent} />
        </div>
      ) : null}

      {summary.failureDetail ? (
        <div
          className="mt-3 rounded-[0.4rem] border border-destructive/40 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {summary.failureHeading}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-destructive/90">{summary.failureDetail}</p>
        </div>
      ) : null}

      <ImagerySubmitted job={job} />
      <ArtifactList
        job={job}
        now={now}
        custody={custody}
        custodyUnreadableReason={custodyUnreadableReason}
      />
      <BenchmarkSummary value={job.benchmark_summary} />
      <JobIdentifiers job={job} />
    </article>
  );
}

export function AerialProcessingJobsPanel({
  jobs,
  summaries,
  now,
  unreadableReason,
  custodyByJobId,
  custodyUnreadableReason,
  truncated = false,
}: {
  jobs: AerialProcessingJobRow[];
  summaries: AerialProcessingJobSummary[];
  now: Date;
  unreadableReason: string | null;
  /**
   * What OpenPlan actually holds for each job, keyed by job id.
   *
   * WITHOUT THIS THE PANEL LIES BY DEFAULT. Its standing note said "OpenPlan
   * records the list, not the files", which stopped being true the moment
   * custody started downloading bytes into a private bucket. A page that tells a
   * planner their deliverables are perishable when they are held — or held when
   * they are perishable — is worse than one that never mentioned it.
   */
  custodyByJobId: Map<string, AerialArtifactCustodyRecord[]>;
  /** Set when the custody ledger could not be READ. Not the same as nothing held. */
  custodyUnreadableReason: string | null;
  /** True when the loader capped the list — see MAX_MISSION_PROCESSING_JOBS. */
  truncated?: boolean;
}) {
  if (unreadableReason) {
    return (
      <StateBlock
        tone="danger"
        title="Processing jobs could not be read"
        description={`${unreadableReason} This is not the same as this mission having no processing jobs — OpenPlan cannot tell you either way right now, so do not read the absence of a job below as evidence that nothing was dispatched.`}
      />
    );
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No imagery processing has been requested for this mission"
        description="Requesting processing records a job here immediately, then advances it as the worker calls back."
      />
    );
  }

  return (
    <div className="space-y-3">
      {truncated ? (
        <p className="text-xs text-[color:var(--copper)]">
          Only the {jobs.length} most recent processing jobs for this mission are listed. Older ones
          exist and are not shown here, so nothing below is a complete history of this mission&apos;s
          processing.
        </p>
      ) : null}
      {jobs.map((job, index) => (
        <AerialProcessingJobCard
          key={job.id}
          job={job}
          summary={summaries[index]}
          now={now}
          custody={custodyByJobId.get(job.id) ?? []}
          custodyUnreadableReason={custodyUnreadableReason}
        />
      ))}
    </div>
  );
}
