import { gtfsClientSubmission, readGtfsClientRequests, retainGtfsClientRequest, dismissGtfsClientRequest,
 type GtfsClientIntent, type GtfsClientRequest, type GtfsClientScope } from "./managed-client";
import { gtfsClientDecisionRequest, readGtfsClientDecisions, retainGtfsClientDecision, dismissGtfsClientDecision, type GtfsClientDecision } from "./managed-client-decision";
import { readGtfsClientProgress, readGtfsClientReview } from "./managed-progress";
import { fetchGtfsClientJson, readGtfsClientDecisionReceipt } from "./managed-client-transport";
import type { GtfsAdoptionReview } from "./managed-human-command";
import { z } from "zod";

type Progress = ReturnType<typeof readGtfsClientProgress>;
export type GtfsClientJob = { request: GtfsClientRequest; progress: Progress | null; error: string | null };
export type GtfsDecisionState = { decision: GtfsClientDecision; state: "unchecked" | "unconfirmed" | "confirmed"; error: string | null };
export type GtfsClientSnapshot = { jobs: GtfsClientJob[]; decisions: GtfsDecisionState[]; busy: string[]; error: string | null };
type Options = { scope: GtfsClientScope; store: Pick<Storage, "getItem" | "setItem">; readOnly: boolean; fetcher: typeof fetch;
 changed: (snapshot: GtfsClientSnapshot) => void; registryChanged: () => void; deadlineMs?: number };

/** Poll committed status, while retries and human decisions remain explicit.
 * Browser transport cancellation does not retract an import. Disposed scopes
 * cannot publish late responses into the next actor or workspace's interface.
 */
export class GtfsClientController {
 private ending = new AbortController();
 private timer: ReturnType<typeof setTimeout> | undefined;
 private polling = false;
 private reads = new Map<string, number>();
 private loaded = false;
 private snapshot: GtfsClientSnapshot = { jobs: [], decisions: [], busy: [], error: null };
 constructor(private readonly options: Options) {}
 private emit() { if (!this.ending.signal.aborted) this.options.changed(this.snapshot); }
 private message(error: unknown) { return error instanceof Error ? error.message : "Transit acknowledgement is unavailable."; }
 private writable() {
  this.ending.signal.throwIfAborted();
  if (!this.loaded) throw new Error("Retained transit history is unavailable. Nothing was sent.");
  if (this.options.readOnly) throw new Error("Viewers cannot submit or decide transit imports.");
 }
 private async json(path: string, init: RequestInit = {}) {
  return fetchGtfsClientJson(this.options.fetcher, path, init, this.ending.signal, this.options.deadlineMs);
 }
 private async operation(key: string, run: () => Promise<void>) {
  this.writable();
  if (this.snapshot.busy.includes(key)) return;
  this.snapshot = { ...this.snapshot, busy: [...this.snapshot.busy, key] }; this.emit();
  try { await run(); }
  finally { this.snapshot = { ...this.snapshot, busy: this.snapshot.busy.filter(item => item !== key) }; this.emit(); }
 }
 start() {
  this.ending.signal.throwIfAborted();
  try {
   const jobs = readGtfsClientRequests(this.options.store, this.options.scope).map(request => ({ request, progress: null, error: null }));
   const decisions = readGtfsClientDecisions(this.options.store, this.options.scope).map(decision => ({ decision, state: "unchecked" as const, error: null }));
   this.snapshot = { jobs, decisions, busy: [], error: null }; this.loaded = true; this.emit(); void this.loop();
  } catch (error) { this.snapshot = { ...this.snapshot, error: this.message(error) }; this.emit(); }
 }
 private async loop() {
  await this.poll();
  if (!this.ending.signal.aborted) this.timer = setTimeout(() => void this.loop(), 5000);
 }
 dispose() { this.ending.abort(new Error("Transit panel scope ended")); clearTimeout(this.timer); }
 async poll() {
  if (!this.loaded || this.polling || this.ending.signal.aborted) return;
  this.polling = true;
  try { for (const job of [...this.snapshot.jobs]) { if (this.ending.signal.aborted) break; await this.refresh(job.request.requestId); } }
  finally { this.polling = false; }
 }
 async refresh(requestId: string) {
  if (this.ending.signal.aborted) return;
  const before = this.snapshot.jobs.find(job => job.request.requestId === requestId); if (!before) return;
  const generation = (this.reads.get(requestId) ?? 0) + 1; this.reads.set(requestId, generation);
  let progress: Progress | null = null, error: string | null = null;
  try {
   const reply = await this.json(`/api/gtfs/submissions/${requestId}?workspaceId=${this.options.scope.workspaceId}`);
   if (!reply.ok) throw new Error(`Transit progress is unavailable (${reply.status}). Retain this request.`);
   progress = readGtfsClientProgress(reply.body, { workspaceId: this.options.scope.workspaceId, requestId });
  } catch (failure) { error = this.message(failure); }
  if (this.ending.signal.aborted || this.reads.get(requestId) !== generation) return;
  const previous = JSON.stringify(before.progress), next = JSON.stringify(progress);
  this.snapshot = { ...this.snapshot, jobs: this.snapshot.jobs.map(job => job.request.requestId === requestId ? { ...job, progress, error } : job) }; this.emit();
  if (progress !== null && previous !== next) this.options.registryChanged();
 }
 async submit(intent: GtfsClientIntent, file?: File) {
  this.writable();
  const request = retainGtfsClientRequest(this.options.store, this.options.scope, intent);
  this.snapshot = { ...this.snapshot, jobs: [...this.snapshot.jobs, { request, progress: null, error: null }] }; this.emit();
  await this.send(request, file); return request;
 }
 private async send(request: GtfsClientRequest, file?: File) {
  await this.operation(request.requestId, async () => {
   let error: string | null = null;
   try { const transport = gtfsClientSubmission(request, file), reply = await this.json(transport.path, transport.init);
    if (!reply.ok) error = `Submission acknowledgement is unavailable (${reply.status}). Check status before retrying this request.`;
   } catch (failure) { error = this.message(failure); }
   if (this.ending.signal.aborted) return;
   await this.refresh(request.requestId);
   if (error && !this.snapshot.jobs.find(job => job.request.requestId === request.requestId)?.progress?.status
    && !this.snapshot.jobs.find(job => job.request.requestId === request.requestId)?.progress?.cancellation) {
    this.snapshot = { ...this.snapshot, jobs: this.snapshot.jobs.map(job => job.request.requestId === request.requestId ? { ...job, error } : job) }; this.emit();
   }
  });
 }
 async recover(requestId: string) {
  const job = this.snapshot.jobs.find(item => item.request.requestId === requestId); if (!job) throw new Error("Retained transit request is unavailable");
  if (job.progress?.cancellation || ["ready", "failed", "cancelled"].includes(job.progress?.status?.state ?? "")) throw new Error("This request is terminal. Review it or start a new import.");
  await this.operation(requestId, async () => {
   let error: string | null = null;
   try {
    const reply = await this.json(`/api/gtfs/submissions/${requestId}`, { method: "POST", headers: { "content-type": "application/json", "x-openplan-gtfs-request-id": requestId }, body: JSON.stringify({ workspaceId: this.options.scope.workspaceId }) });
    if (!reply.ok) error = `Recovery is unconfirmed (${reply.status}). Retain this request and its original input.`;
   } catch (failure) { error = this.message(failure); }
   if (this.ending.signal.aborted) return;
   await this.refresh(requestId);
   if (error) { this.snapshot = { ...this.snapshot, jobs: this.snapshot.jobs.map(item => item.request.requestId === requestId ? { ...item, error } : item) }; this.emit(); }
  });
 }
 async resupply(requestId: string, file?: File) {
  const job = this.snapshot.jobs.find(item => item.request.requestId === requestId); if (!job) throw new Error("Retained transit request is unavailable");
  if (job.progress?.status || job.progress?.cancellation) throw new Error("Check this existing import. Resupply is for an unconfirmed request.");
  await this.send(job.request, file);
 }
 async review(feedId: string, versionId: string): Promise<GtfsAdoptionReview> {
  feedId = z.string().uuid().parse(feedId); versionId = z.string().uuid().parse(versionId);
  const reply = await this.json(`/api/gtfs/versions/${versionId}/review?workspaceId=${this.options.scope.workspaceId}`);
  if (!reply.ok) throw new Error(`Completed transit review is unavailable (${reply.status}).`);
  return readGtfsClientReview(reply.body, { feedId, versionId });
 }
 async inspect(feedId: string, versionId: string): Promise<Progress> {
  feedId = z.string().uuid().parse(feedId); versionId = z.string().uuid().parse(versionId);
  const reply = await this.json(`/api/gtfs/versions/${versionId}/status?workspaceId=${this.options.scope.workspaceId}`);
  if (!reply.ok) throw new Error(`Managed transit progress is unavailable (${reply.status}). This version may predate managed imports.`);
  const outer = z.object({ requestId: z.string().uuid() }).passthrough().parse(reply.body);
  const progress = readGtfsClientProgress(reply.body, { workspaceId: this.options.scope.workspaceId, requestId: outer.requestId });
  if (!progress.status || progress.status.feedId !== feedId || progress.status.versionId !== versionId) throw new Error("Transit inspected version differs");
  return progress;
 }
 async decide(raw: GtfsClientDecision) {
  this.writable();
  const decision = retainGtfsClientDecision(this.options.store, this.options.scope, raw);
  const existing = this.snapshot.decisions.find(item => item.decision.commandId === decision.commandId);
  if (!existing) { this.snapshot = { ...this.snapshot, decisions: [...this.snapshot.decisions, { decision, state: "unchecked", error: null }] }; this.emit(); }
  await this.operation(decision.commandId, async () => {
   let state: GtfsDecisionState["state"] = "unconfirmed", error: string | null = null;
   try {
    const transport = gtfsClientDecisionRequest(this.options.scope, decision), reply = await this.json(transport.path, transport.init);
    if (!reply.ok) throw new Error(`Decision acknowledgement is unavailable (${reply.status}). Retain this exact command.`);
    readGtfsClientDecisionReceipt(reply.body, this.options.scope.workspaceId, decision); state = "confirmed";
   } catch (failure) { error = this.message(failure); }
   if (this.ending.signal.aborted) return;
   this.snapshot = { ...this.snapshot, decisions: this.snapshot.decisions.map(item => item.decision.commandId === decision.commandId ? { decision, state, error } : item) }; this.emit();
   this.options.registryChanged();
   for (const job of [...this.snapshot.jobs]) await this.refresh(job.request.requestId);
  });
 }
 dismissRequest(requestId: string) {
  this.ending.signal.throwIfAborted();
  if (this.snapshot.busy.includes(requestId)) throw new Error("Wait for this request acknowledgement before removing browser history.");
  dismissGtfsClientRequest(this.options.store, this.options.scope, requestId);
  this.snapshot = { ...this.snapshot, jobs: this.snapshot.jobs.filter(job => job.request.requestId !== requestId) }; this.emit();
 }
 dismissDecision(commandId: string) {
  this.ending.signal.throwIfAborted();
  if (this.snapshot.busy.includes(commandId)) throw new Error("Wait for this decision acknowledgement before removing browser history.");
  dismissGtfsClientDecision(this.options.store, this.options.scope, commandId);
  this.snapshot = { ...this.snapshot, decisions: this.snapshot.decisions.filter(item => item.decision.commandId !== commandId) }; this.emit();
 }
}
