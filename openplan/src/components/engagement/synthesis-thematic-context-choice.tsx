"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SynthesisContextOutputReader } from "./synthesis-context-output-reader";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import { inspectThematicContextPage, type ThematicInputScope, type inspectThematicContributionPage } from "@/lib/engagement/synthesis-thematic-choice-discovery";
import { inspectSynthesisThematicChoicePreview, type synthesisThematicChoiceReceiptSchema } from "@/lib/engagement/synthesis-thematic-choice-command";
import { freezeThematicChoice, readPendingThematicChoice, sendThematicChoice, preservePendingThematicChoice,
  listPreservedThematicChoices, type PendingThematicChoice } from "@/lib/engagement/synthesis-thematic-choice-recovery";
import { ReviewSaveError } from "@/lib/engagement/synthesis-review-recovery";
import { verifySynthesisProgress } from "@/lib/engagement/synthesis-progress";
import type { SynthesisRequestHistoryCursor, SynthesisRequestHistoryPage } from "@/lib/engagement/synthesis-request-history";

type Receipt = ReturnType<typeof synthesisThematicChoiceReceiptSchema.parse>;
type Preview = Awaited<ReturnType<typeof inspectSynthesisThematicChoicePreview>>;
type Entry = SynthesisRequestHistoryPage["entries"][number];
type Props = ThematicInputScope & { userId: string; targetRecordId: string; label: string; thematicSha256: string;
  saved: Awaited<ReturnType<typeof inspectThematicContributionPage>>["choices"][number]; onAccessLost: () => void; onSaved: (receipt: Receipt) => void };
const message = (cause: unknown) => cause instanceof Error ? cause.message : "The context choice could not be confirmed. Keep the original request and refresh access.";

export function SynthesisThematicContextChoice(props: Props) {
  return <Choice key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}:${props.requestId}:${props.requestIntentSha256}:${props.actorId}:${props.targetRecordId}:${props.thematicSha256}`} {...props} />;
}

function Choice({ userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, requestIntentSha256, actorId,
  targetRecordId, thematicSha256, label, saved, onAccessLost, onSaved }: Props) {
  const scope = useMemo(() => ({ workspaceId, campaignId, sourceId, sourceSha256, requestId, requestIntentSha256, actorId }),
    [workspaceId, campaignId, sourceId, sourceSha256, requestId, requestIntentSha256, actorId]);
  const recoveryScope = useMemo(() => ({ userId, workspaceId, campaignId, requestId, targetRecordId }), [userId, workspaceId, campaignId, requestId, targetRecordId]);
  const [pending, setPending] = useState<PendingThematicChoice | null>(null), [copies, setCopies] = useState<ReturnType<typeof listPreservedThematicChoices>>([]);
  const [storageReady, setStorageReady] = useState(false), [storageBlocked, setStorageBlocked] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null), [cursor, setCursor] = useState<SynthesisRequestHistoryCursor | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), writing = useRef(false), scanned = useRef(new Set<string>());
  const restore = useCallback(() => {
    try { setPending(readPendingThematicChoice(localStorage, recoveryScope)); setCopies(listPreservedThematicChoices(localStorage, recoveryScope)); setStorageBlocked(false); }
    catch { setStorageBlocked(true); setError("Browser recovery could not be read. Preserve its original bytes before choosing another context."); }
    setStorageReady(true);
  }, [recoveryScope]);
  const loseAccess = useCallback(() => {
    active.current?.abort(); setEntries(null); setPreview(null); setPending(null); setCopies([]); setBusy(false); setStorageBlocked(true); onAccessLost();
  }, [onAccessLost]);
  useEffect(() => { restore(); return () => { active.current?.abort(); active.current = null; }; }, [restore]);
  const read = useCallback(async (url: string, controller: AbortController) => {
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    const response = await readSynthesisHistory(url, { userId, workspaceId,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]), isCurrent });
    if (!isCurrent()) throw new Error("The selected contribution changed");
    if ([401, 403].includes(response.status)) { loseAccess(); throw new Error("Current staff access could not be confirmed. Reopen this consultation."); }
    if (!response.ok) throw new Error("Saved context could not be read. Refresh this read before choosing context.");
    return response.json() as Promise<unknown>;
  }, [userId, workspaceId, loseAccess]);

  async function discover(before: SynthesisRequestHistoryCursor | null = null) {
    if (writing.current) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setPreview(null);
    if (!before) { setEntries(null); setCursor(null); scanned.current = new Set(); }
    try {
      const query = new URLSearchParams({ mode: "contexts", requestId, targetRecordId });
      if (before) { query.set("beforeId", before.id); query.set("beforeCreatedAt", before.createdAt); }
      const result = inspectThematicContextPage(await read(`/api/engagement/campaigns/${campaignId}/synthesis/thematic-choices?${query}`, controller), scope, targetRecordId, before);
      if (result.thematicSha256 !== thematicSha256 || result.history.entries.some(entry => scanned.current.has(entry.requestId))) throw new Error("Context discovery changed");
      if (!current()) return;
      result.history.entries.forEach(entry => scanned.current.add(entry.requestId));
      const eligible = result.history.entries.filter(entry => result.eligibleRequestIds.includes(entry.requestId));
      setEntries(previous => before ? [...(previous ?? []), ...eligible] : eligible); setCursor(result.history.nextCursor);
    } catch (cause) { if (current()) { setEntries(null); setCursor(null); setError(message(cause)); } }
    finally { if (current()) setBusy(false); }
  }
  async function inspect(entry: Entry) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setPreview(null);
    try {
      const progress = verifySynthesisProgress(await read(`/api/engagement/campaigns/${campaignId}/synthesis/progress?${new URLSearchParams({ requestId: entry.requestId, stage: "context" })}`, controller), {
        campaignId, workspaceId, sourceId, sourceSha256, requestId: entry.requestId, actorId: entry.actorId, requestIntentSha256: entry.intentSha256, stage: "context" });
      if (progress.status !== "frames_complete" || progress.selectionSequence === null) throw new Error("This context is not complete. Finish its request in saved history, then inspect it again.");
      const selection = { requestId, targetRecordId, contextRequestId: entry.requestId, throughSequence: progress.selectionSequence };
      const query = new URLSearchParams(Object.entries({ mode: "inspect", ...selection }).map(([key, value]) => [key, String(value)]));
      const result = await inspectSynthesisThematicChoicePreview(await read(`/api/engagement/campaigns/${campaignId}/synthesis/thematic-choices?${query}`, controller), { campaignId, workspaceId, actorId: userId }, selection);
      if (result.command.expected.requestIntentSha256 !== requestIntentSha256 || result.command.expected.thematicSha256 !== thematicSha256 ||
        JSON.parse(result.command.expected.choiceText).historyManifestSha256 !== progress.manifestSha256) throw new Error("Inspected context differs from its saved results");
      if (current()) setPreview(result);
    } catch (cause) { if (current()) setError(message(cause)); }
    finally { if (current()) setBusy(false); }
  }
  async function inspectSaved() {
    if (!saved || writing.current) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setPreview(null);
    try {
      const choice = JSON.parse(saved.choiceText) as { contextRequestId: string; selectionSequence: number };
      const selection = { requestId, targetRecordId, contextRequestId: choice.contextRequestId, throughSequence: choice.selectionSequence };
      const query = new URLSearchParams(Object.entries({ mode: "inspect", ...selection }).map(([key, value]) => [key, String(value)]));
      const result = await inspectSynthesisThematicChoicePreview(await read(`/api/engagement/campaigns/${campaignId}/synthesis/thematic-choices?${query}`, controller), { campaignId, workspaceId, actorId: userId }, selection);
      if (result.command.expected.requestIntentSha256 !== requestIntentSha256 || result.command.expected.thematicSha256 !== thematicSha256 ||
        result.command.expected.choiceText !== saved.choiceText) throw new Error("Inspected context differs from the saved choice");
      if (current()) setPreview(result);
    } catch (cause) { if (current()) setError(message(cause)); }
    finally { if (current()) setBusy(false); }
  }
  async function save(retry = false) {
    if (writing.current || storageBlocked || !storageReady || (!retry && (saved || !preview || preview.cancelled))) return;
    writing.current = true; active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setNotice(null);
    try {
      const command = retry ? pending : freezeThematicChoice(localStorage, recoveryScope, preview!.command);
      if (!command) throw new Error("Reopen the retained context choice before retrying");
      setPending(command);
      const result = await sendThematicChoice(localStorage, command, { signal: controller.signal, isCurrent: current });
      if (!current()) return;
      restore(); setPreview(null); setNotice(result.cleanupError ?? "Context choice saved. It does not approve the generated wording."); onSaved(result.receipt);
    } catch (cause) {
      if (current()) {
        setPreview(null);
        if (cause instanceof ReviewSaveError && [401, 403].includes(cause.status)) loseAccess(); else restore();
        setError(message(cause));
      }
    } finally { writing.current = false; if (current()) setBusy(false); }
  }
  function preserve() {
    try { preservePendingThematicChoice(localStorage, recoveryScope); restore(); setError(null); setNotice("Recovery copy preserved in this browser. Refresh choices to check the saved server choice; preservation does not change it."); }
    catch (cause) { setError(message(cause)); }
  }
  return <section aria-label={`Context choice for ${label}`} className="min-w-0 space-y-3 border-t border-border pt-3">
    <h5 className="break-words font-semibold">Context for {label}</h5>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}{busy ? <p role="status">Checking saved context…</p> : null}
    {saved ? <div className="space-y-2">
      <p className="text-sm">A context choice is saved for this contribution. It is fixed for this theme request. Start another theme request to use different context.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void inspectSaved()}>Read saved context</Button>
      <details><summary className="cursor-pointer">Saved context choice reference</summary><pre className="whitespace-pre-wrap break-all text-xs">{saved.choiceText}</pre></details>
    </div> : null}
    {pending ? <div className="space-y-2">
      <p className="text-sm">An unconfirmed context choice remains in this browser. Retry its original command; selecting a newer result does not replace it.</p>
      <details><summary className="cursor-pointer">Inspect the retained choice before retrying</summary><pre className="whitespace-pre-wrap break-all text-xs">{pending.commandText}</pre></details>
      <Button type="button" disabled={busy || storageBlocked} onClick={() => void save(true)}>Retry saved context choice</Button>
    </div> : null}
    {pending || storageBlocked ? <Button type="button" variant="outline" disabled={busy} onClick={preserve}>Preserve context choice copy</Button> : null}
    {!saved && !pending ? <>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void discover()}>Find eligible contexts</Button>
      <p className="max-w-prose text-sm">Requests must use this contribution and the same saved parent results. Inspecting one checks whether its original output is complete.</p>
      {entries?.length === 0 ? <p className="text-sm">No eligible context appears in the loaded history. Check older history if available, or combine this contribution from its parent results first.</p> : null}
      <ul className="space-y-2">{entries?.map(entry => <li key={entry.requestId}>
        <Button type="button" variant="outline" disabled={busy} className="text-left" onClick={() => void inspect(entry)}>
          Inspect context {entry.requestId.slice(0, 8)} saved {new Date(entry.createdAt).toLocaleString("en-US")}
        </Button>
        {entry.cancelled ? <p className="text-sm">This context request was cancelled. Earlier completed output may still be inspected.</p> : null}
      </li>)}</ul>
      {cursor ? <Button type="button" variant="outline" disabled={busy} onClick={() => void discover(cursor)}>Check older context requests</Button> : null}
    </> : null}
    {preview ? <div className="space-y-2">
        <SynthesisContextOutputReader outputText={preview.outputText} outputSha256={preview.outputSha256} contextRequestId={preview.command.contextRequestId} />
        {preview.cancelled ? <p className="text-sm">This theme request is cancelled. Start another request to choose context.</p> : null}
        {!saved && !pending ? <Button type="button" disabled={busy || !storageReady || storageBlocked || preview.cancelled} onClick={() => void save()}>Use this context</Button> : null}
      </div> : null}
    {copies.length ? <details><summary className="cursor-pointer">Preserved context choice copies ({copies.length})</summary>
      <p className="text-sm">These private copies retain exact commands. Downloading a copy does not send it.</p>
      {copies.map((copy, index) => <Button key={copy.key} type="button" variant="outline" onClick={() => {
        const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/json" })), anchor = document.createElement("a");
        anchor.href = url; anchor.download = `openplan-context-choice-recovery-${index + 1}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download context choice copy {index + 1}</Button>)}</details> : null}
  </section>;
}
