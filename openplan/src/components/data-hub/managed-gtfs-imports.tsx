"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { GtfsClientController, type GtfsClientJob, type GtfsClientSnapshot } from "@/lib/gtfs/managed-client-controller";
import type { GtfsClientIntent, GtfsClientScope } from "@/lib/gtfs/managed-client";
import type { GtfsAdoptionReview } from "@/lib/gtfs/managed-human-command";
import type { readGtfsClientProgress } from "@/lib/gtfs/managed-progress";

export type ManagedGtfsImportsHandle = {
 submit: (intent: GtfsClientIntent, file?: File) => Promise<void>;
 openVersion: (feedId: string, versionId: string) => void;
};
export type ManagedGtfsVersion = { feedId: string; versionId: string; label: string };
const button = "rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50";
const empty: GtfsClientSnapshot = { jobs: [], decisions: [], busy: [], error: null };
type Progress = ReturnType<typeof readGtfsClientProgress>;
function message(error: unknown) { return error instanceof Error ? error.message : "Transit progress is unavailable."; }
function progressLabel(progress: Progress | null, error: string | null) {
 if (error) return "Progress unavailable";
 if (progress?.cancellation) return "Cancelled";
 const status = progress?.status;
 if (!status) return "Submission unconfirmed";
 if (status.isCurrent) return "In use";
 if (status.state === "ready") return "Ready for review";
 if (status.state === "failed") return "Processing failed";
 if (status.state === "cancelled") return "Cancelled";
 if (status.stage === "parsing") return "Reading schedules";
 if (status.stage === "fetching") return "Retaining the archive";
 return "Waiting for a worker";
}

/** Explain a malformed archive without exposing ZIP-library debugging guidance.
 * Keep other recorded failures distinct and leave their diagnostic records intact.
 */
function failureMessage(status: Pick<NonNullable<Progress["status"]>, "failureCode" | "failureDetail"> | null | undefined) {
 if (status?.failureCode === "not_a_zip") return "This file could not be opened as a ZIP archive. Choose the agency's GTFS ZIP file and start a new import.";
 return status?.failureDetail ?? (status?.failureCode ? `Processing failed. Diagnostic code: ${status.failureCode}. No additional failure detail was recorded.` : null);
}

function CancelRequest({ requestId, controller, disabled, report }: { requestId: string; controller: GtfsClientController; disabled: boolean; report: (error: unknown) => void }) {
 const [reason, setReason] = useState("");
 return <div className="mt-3 space-y-2">
  <label className="block text-sm">Reason for cancellation
   <textarea aria-label={`Reason for cancelling ${requestId}`} className="mt-1 w-full rounded-md border border-border bg-background p-2" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} disabled={disabled} />
  </label>
  <button type="button" className={button} disabled={disabled || !reason.trim()} onClick={() => { void controller.decide({ operation: "cancel_request", commandId: crypto.randomUUID(), requestId, reason: reason.trim() }).catch(report); }}>Cancel this request</button>
 </div>;
}

function VersionView({ version, controller, readOnly, deciding, report }: { version: ManagedGtfsVersion; controller: GtfsClientController; readOnly: boolean; deciding: boolean; report: (error: unknown) => void }) {
 const [view, setView] = useState<{ progress: Progress | null; review: GtfsAdoptionReview | null; error: string | null; loading: boolean }>({ progress: null, review: null, error: null, loading: true });
 const [accept, setAccept] = useState(false);
 const generation = useRef(0), alive = useRef(true);
 const reload = useCallback(() => {
  if (!alive.current) return Promise.resolve();
  const read = ++generation.current;
  let progress: Progress | null = null;
  return controller.inspect(version.feedId, version.versionId).then(async result => {
   progress = result;
   const review = result.status?.state === "ready" ? await controller.review(version.feedId, version.versionId) : null;
   if (alive.current && generation.current === read) { setAccept(false); setView({ progress, review, error: null, loading: false }); }
  }).catch(failure => {
   if (alive.current && generation.current === read) { setAccept(false); setView({ progress, review: null, error: message(failure), loading: false }); }
  });
 }, [controller, version.feedId, version.versionId]);
 useEffect(() => {
  alive.current = true; void reload();
  return () => { alive.current = false; };
 }, [reload]);
 const status = view.progress?.status, review = view.review;
 const failure = failureMessage(status);
 const terminal = view.progress?.cancellation || ["ready", "failed", "cancelled"].includes(status?.state ?? "");
 return <section className="module-subpanel mt-3 space-y-2" aria-label="Selected transit version">
  <h4 className="font-semibold">{version.label}</h4>
  <p className="text-xs text-muted-foreground">Version {version.versionId}</p>
  <p>{view.loading ? "Reading version progress and review" : progressLabel(view.progress, view.error)}</p>
  {view.error && <p role="alert" className="text-sm text-muted-foreground">{view.error}</p>}
  {failure && <p className="text-sm">{failure}</p>}
  {status?.submitterAccessUnavailable && <p className="text-sm">The original submitter&apos;s current write access is unavailable. Processing cannot assume their authority.</p>}
  {review && <div className="space-y-2 text-sm">
   <p>Completed schedule: {review.basis.routeCount} routes and {review.basis.stopCount} stops. These are parser counts, not derived service rows or measured coverage.</p>
   {review.basis.previousVersionId ? <p>Reviewed predecessor: {review.basis.previousRouteCount} routes and {review.basis.previousStopCount} stops. Version {review.basis.previousVersionId}.</p> : <p>No predecessor is currently in use.</p>}
   {review.materialShrinkage && <label className="flex items-start gap-2"><input type="checkbox" checked={accept} disabled={readOnly || deciding} onChange={event => setAccept(event.target.checked)} /><span>I accept the reduction greater than 20 percent in routes or stops for this reviewed version.</span></label>}
   {review.isCurrent ? <p>This version is currently in use.</p> : <button type="button" className={button} disabled={readOnly || deciding || view.loading || (review.materialShrinkage && !accept)} onClick={() => {
    void controller.decide({ operation: "adopt", commandId: crypto.randomUUID(), versionId: version.versionId, basis: review.basis, acceptMaterialShrinkage: accept }).then(() => { setView(previous => ({ ...previous, loading: true })); return reload(); }).catch(report);
   }}>Use this reviewed version</button>}
   <p className="text-muted-foreground">A changed predecessor requires a new review. A recorded historical command does not prove which version is in use now.</p>
  </div>}
  <button type="button" className={button} disabled={view.loading} onClick={() => { setView(previous => ({ ...previous, loading: true })); void reload(); }}>Read version again</button>
  {!readOnly && status && !terminal && <CancelRequest requestId={status.requestId} controller={controller} disabled={deciding} report={report} />}
 </section>;
}

function Job({ job, controller, readOnly, busy, maxUploadBytes, open, report }: { job: GtfsClientJob; controller: GtfsClientController; readOnly: boolean; busy: boolean; maxUploadBytes: number; open: (feedId: string, versionId: string) => void; report: (error: unknown) => void }) {
 const [file, setFile] = useState<File | undefined>();
 const status = job.progress?.status, cancelled = job.progress?.cancellation;
 const failure = failureMessage(status);
 const terminal = !!cancelled || ["ready", "failed", "cancelled"].includes(status?.state ?? "");
 const intent = job.request.intent;
 return <li className="module-subpanel space-y-2" data-testid={`gtfs-managed-request-${job.request.requestId}`}>
  <p className="font-semibold">{progressLabel(job.progress, job.error)}</p>
  <p className="text-sm">{intent.source === "url" ? intent.url : intent.source === "upload" ? intent.filename : intent.source === "catalog" ? `Catalog feed ${intent.catalogId}` : `Refresh feed ${intent.feedId}`}</p>
  <p className="text-xs text-muted-foreground">Request {job.request.requestId}</p>
  {status && <p className="text-xs text-muted-foreground">Version {status.versionId}. Worker attempts: {status.attempts}.</p>}
  {job.error && <p role="alert" className="text-sm">{job.error}</p>}
  {failure && <p className="text-sm">{failure}</p>}
  {status?.submitterAccessUnavailable && <p className="text-sm">The original submitter&apos;s write access is unavailable. An acknowledgement error does not authorize a new actor to replay their input.</p>}
  {(cancelled?.versionCancellation?.cleanupPending || status?.state === "cancelled") && <p className="text-sm text-muted-foreground">Archive cleanup can remain pending after processing closes.</p>}
  <div className="flex flex-wrap gap-2">
   <button type="button" className={button} disabled={busy} onClick={() => void controller.refresh(job.request.requestId)}>Check progress</button>
   {status && <button type="button" className={button} onClick={() => open(status.feedId, status.versionId)}>Open version</button>}
   {!readOnly && !terminal && <button type="button" className={button} disabled={busy} onClick={() => void controller.recover(job.request.requestId).catch(report)}>Recover saved input</button>}
   <button type="button" className={button} disabled={busy} onClick={() => { try { controller.dismissRequest(job.request.requestId); } catch (error) { report(error); } }}>Remove browser record</button>
  </div>
  {!readOnly && !status && !cancelled && <div className="space-y-2 text-sm">
   <p>Recover the server&apos;s saved input first. If it is unavailable, resupply the exact original input with this request UUID.</p>
   {intent.source === "upload" && <label className="block">Original ZIP for this request<input type="file" accept=".zip,application/zip" className="mt-1 block w-full" disabled={busy} onChange={event => setFile(event.target.files?.[0])} /></label>}
   <button type="button" className={button} disabled={busy || (intent.source === "upload" && !file)} onClick={() => {
    if (file && file.size > maxUploadBytes) { report(new Error("The original ZIP exceeds this installation's upload limit. Nothing was sent.")); return; }
    void controller.resupply(job.request.requestId, file).catch(report);
   }}>Resupply original input</button>
  </div>}
  {!readOnly && !terminal && <CancelRequest requestId={job.request.requestId} controller={controller} disabled={busy} report={report} />}
  {status?.state === "failed" && <p className="text-sm">This version remains failed. Start a new import to try processing again; its bytes and identity stay separate.</p>}
 </li>;
}

/** Existing import doors call this retained controller. All progress comes
 * from scoped committed reads; sending a request never announces completion.
 */
export const ManagedGtfsImports = forwardRef<ManagedGtfsImportsHandle, { scope: GtfsClientScope; readOnly: boolean; maxUploadBytes: number; versions: ManagedGtfsVersion[]; registryChanged: () => void }>(function ManagedGtfsImports({ scope, readOnly, maxUploadBytes, versions, registryChanged }, ref) {
 const [snapshot, setSnapshot] = useState(empty), [controller, setController] = useState<GtfsClientController | null>(null), [error, setError] = useState<string | null>(null);
 const [selection, setSelection] = useState<ManagedGtfsVersion | null>(null);
 const router = useRouter();
 const { installationId, workspaceId, actorId } = scope;
 const registryRef = useRef(registryChanged);
 useEffect(() => { registryRef.current = () => { registryChanged(); router.refresh(); }; }, [registryChanged, router]);
 useEffect(() => {
  let owned: GtfsClientController | undefined;
  try {
   owned = new GtfsClientController({ scope: { installationId, workspaceId, actorId }, readOnly, store: window.localStorage, fetcher: window.fetch.bind(window), changed: setSnapshot, registryChanged: () => registryRef.current() });
   setController(owned); owned.start();
  } catch (failure) { setError(message(failure)); }
  return () => owned?.dispose();
 }, [installationId, workspaceId, actorId, readOnly]);
 function report(failure: unknown) { setError(message(failure)); }
 function open(feedId: string, versionId: string) { setSelection(versions.find(item => item.feedId === feedId && item.versionId === versionId) ?? { feedId, versionId, label: "Transit version" }); }
 useImperativeHandle(ref, () => ({
  submit: async (intent, file) => { if (!controller) throw new Error("Retained transit history is not ready. Nothing was sent."); setError(null); await controller.submit(intent, file); },
  openVersion: open,
 }));
 return <section className="mt-5 space-y-3" aria-label="Managed transit imports" data-testid="gtfs-managed-imports">
  <h3 className="font-semibold">Import progress and completed-version review</h3>
  <p className="text-sm text-muted-foreground">Imports continue in the installed worker after this page closes. Processing completion does not put a version into use. Review its completed counts before adopting it. Service results describe published schedules, not observed operations.</p>
  <p className="text-sm text-muted-foreground">This browser retains request and command identities for this installation, workspace and account. Removing a browser record does not cancel processing or retract a decision. ZIP bytes are retained privately on the installation, not in browser history.</p>
  {(error || snapshot.error) && <p role="alert" className="module-note text-sm">{error ?? snapshot.error}</p>}
  {!controller && !error && <p className="text-sm">Reading retained import history</p>}
  {controller && <>
   <ul className="space-y-3">{snapshot.jobs.map(job => <Job key={job.request.requestId} job={job} controller={controller} readOnly={readOnly} busy={snapshot.busy.length > 0} maxUploadBytes={maxUploadBytes} open={open} report={report} />)}</ul>
   {snapshot.jobs.length === 0 && !snapshot.error && <p className="text-sm text-muted-foreground">This browser has no retained transit requests for this account. Workspace versions below remain separately readable.</p>}
   {versions.length > 0 && <label className="block space-y-2 text-sm font-semibold">Open a recent workspace version<select className="block w-full rounded-md border border-border bg-background p-2 font-normal" value={selection && versions.some(version => version.versionId === selection.versionId) ? selection.versionId : ""} onChange={event => setSelection(versions.find(version => version.versionId === event.target.value) ?? null)}><option value="">Select a version</option>{versions.map(version => <option key={version.versionId} value={version.versionId}>{version.label}: {version.versionId.slice(0, 8)}</option>)}</select></label>}
   {selection && <VersionView key={`${selection.feedId}:${selection.versionId}`} version={selection} controller={controller} readOnly={readOnly} deciding={snapshot.busy.length > 0} report={report} />}
   {snapshot.decisions.length > 0 && <div className="space-y-2"><h4 className="font-semibold">Retained decisions</h4><ul className="space-y-2">{snapshot.decisions.map(item => <li key={item.decision.commandId} className="module-subpanel space-y-2 text-sm">
    <p>{item.decision.operation === "adopt" ? "Adoption" : "Cancellation"}. {item.state === "confirmed" ? "Exact command receipt confirmed in this session." : item.state === "unchecked" ? "Receipt has not been checked in this session." : "Command acknowledgement unconfirmed."}</p>
    <p className="text-xs text-muted-foreground">Command {item.decision.commandId}</p>
    <p>{item.decision.operation === "adopt" ? `Version ${item.decision.versionId}. Reviewed ${item.decision.basis.routeCount} routes and ${item.decision.basis.stopCount} stops.` : `Request ${item.decision.requestId}. Reason: ${item.decision.reason}`}</p>
    {item.error && <p role="alert">{item.error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={readOnly || snapshot.busy.length > 0} onClick={() => void controller.decide(item.decision).catch(report)}>Replay exact command</button><button type="button" className={button} disabled={snapshot.busy.length > 0} onClick={() => { try { controller.dismissDecision(item.decision.commandId); } catch (failure) { report(failure); } }}>Remove browser decision record</button></div>
   </li>)}</ul></div>}
  </>}
 </section>;
});
