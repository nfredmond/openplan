"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inspectSynthesisGenerationRequest } from "@/lib/engagement/synthesis-generation-request-browser";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import type { SynthesisGenerationClientScope } from "@/lib/engagement/synthesis-generation-request-recovery";
import { SynthesisGenerationCancelPanel } from "./synthesis-generation-cancel-panel";

type Props = SynthesisGenerationClientScope & { requestId: string; actorId: string; intentSha256: string;
  onAccessLost: () => void; onCancelled: () => void };
type Record = Awaited<ReturnType<typeof inspectSynthesisGenerationRequest>>;

/** Reopen the original intent through current native authorization before
 * offering cancellation. A history hash alone is not an executable command.
 */
export function SynthesisGenerationCancellationInspector(props: Props) {
  return <Inspector key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}:${props.requestId}:${props.intentSha256}:${props.actorId}`} {...props} />;
}

function Inspector({ userId, workspaceId, campaignId, sourceId, sourceSha256,
  requestId, actorId, intentSha256, onAccessLost, onCancelled }: Props) {
  const [open, setOpen] = useState(false), [saved, setSaved] = useState<Record | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setSaved(null); setError(null);
    try {
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${campaignId}/synthesis/generation?requestId=${requestId}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), isCurrent,
      });
      if (response.status === 401 || response.status === 403) { onAccessLost(); throw new Error(); }
      if (!response.ok) throw new Error();
      const result = await inspectSynthesisGenerationRequest(await response.json(), { workspaceId, campaignId, requestId });
      if (!result.state.request || result.state.request.actorId !== actorId || result.state.request.intentSha256 !== intentSha256 ||
        result.intent?.sourceId !== sourceId || result.intent.sourceSha256 !== sourceSha256) throw new Error();
      if (isCurrent()) setSaved(result);
    } catch { if (isCurrent()) setError("The original request could not be confirmed. Refresh its details before making a cancellation."); }
    finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, actorId, intentSha256, onAccessLost]);
  useEffect(() => { if (open) void read(); return () => { active.current?.abort(); active.current = null; }; }, [open, read]);
  return <section aria-label="Saved request cancellation" className="min-w-0 space-y-3">
    <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen(value => !value)}>Review cancellation options</Button>
    {open ? <div className="space-y-3">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void read()}>Refresh original request</Button>
      {busy ? <p role="status">Reading the original request…</p> : null}{error ? <p role="alert">{error}</p> : null}
      {saved?.state.request ? <>
        <p className="break-words text-sm">Original model: {saved.intent?.modelId}. This view does not authorize a provider call.</p>
        {saved.cancellation ? <p className="whitespace-pre-wrap break-words text-sm">Recorded cancellation reason: {saved.cancellation.reason}</p> : null}
        <SynthesisGenerationCancelPanel userId={userId} workspaceId={workspaceId} campaignId={campaignId} sourceId={sourceId} sourceSha256={sourceSha256}
          requestId={requestId} intentText={saved.state.request.intentText} actorId={actorId} cancelled={saved.cancellation !== null}
          onAccessLost={onAccessLost} onCancelled={result => { setSaved(result); onCancelled(); }} />
      </> : null}
    </div> : null}
  </section>;
}
