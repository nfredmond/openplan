"use client";

/**
 * READING A PLAN DOCUMENT — the door into the whole lane.
 *
 * A planner picks a document already in this workspace's library and asks
 * OpenPlan to read it. What comes back is a QUEUE OF PROPOSALS, not a change to
 * the plan: nothing in the plan moves until somebody reviews a card below and
 * saves it.
 *
 * WHAT THIS COMPONENT INSISTS ON SAYING:
 *
 *   - How much was dropped. The run route answers with what it proposed AND
 *     what the verifier threw away; showing only the survivors would present a
 *     clean-looking reading and hide how much of it the model got wrong.
 *   - Which documents cannot be read, and why. A scanned plan with no text
 *     layer is the common case, and it is a different answer from "nothing was
 *     found in it". Documents that cannot be transcribed from are listed with
 *     the reason rather than quietly missing from the picker.
 *   - That reading the same document twice stages a second set of proposals.
 *     There is no de-duplication (Q8); the route warns and this repeats it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ExtractionSourceDocument = {
  id: string;
  title: string;
  /** null when the document can be read. A sentence when it cannot. */
  unreadableReason: string | null;
};

export function ExtractionRunLauncher({
  rtpCycleId,
  documents,
  canWrite,
}: {
  rtpCycleId: string;
  documents: readonly ExtractionSourceDocument[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const readable = documents.filter((document) => document.unreadableReason === null);
  const unreadable = documents.filter((document) => document.unreadableReason !== null);

  const [documentId, setDocumentId] = useState(readable[0]?.id ?? "");
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function read() {
    if (!documentId) return;
    setIsReading(true);
    setError(null);
    setSummary(null);
    setWarning(null);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/extraction-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbDocumentId: documentId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        warning?: string | null;
        summary?: { proposed?: number; discarded?: number };
      };

      if (!response.ok) {
        setError(payload.error ?? "This document could not be read.");
        return;
      }

      const proposed = payload.summary?.proposed ?? 0;
      const discarded = payload.summary?.discarded ?? 0;
      setSummary(
        discarded > 0
          ? `${proposed + discarded} proposed; ${discarded} dropped because ${
              discarded === 1 ? "its figures were" : "their figures were"
            } not in the text ${discarded === 1 ? "it" : "they"} cited. ${proposed} ${
              proposed === 1 ? "is" : "are"
            } waiting for review below.`
          : `${proposed} ${proposed === 1 ? "proposal is" : "proposals are"} waiting for review below. Nothing was dropped.`
      );
      setWarning(payload.warning ?? null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This document could not be read.");
    } finally {
      setIsReading(false);
    }
  }

  return (
    <div className="space-y-3">
      {readable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No document in this workspace&apos;s library can be transcribed from yet. Upload the adopted
          plan as a document, and OpenPlan will read its pages so figures can be copied out of it with
          the page they came from.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[16rem] flex-1 space-y-1 text-xs">
            <span className="font-medium text-foreground">Document to read</span>
            <select
              className="h-9 w-full rounded-[0.4rem] border border-border bg-background px-2 text-sm"
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              disabled={isReading || !canWrite}
            >
              {readable.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" size="sm" onClick={read} disabled={isReading || !canWrite || !documentId}>
            {isReading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <BookOpenCheck className="mr-1.5 h-4 w-4" />
            )}
            Read this document
          </Button>
        </div>
      )}

      {isReading ? (
        <p className="text-xs text-muted-foreground">
          Reading the document a page at a time. A long plan takes a while — nothing is written to the
          plan by this, so it is safe to leave and come back.
        </p>
      ) : null}
      {summary ? <p className="text-sm text-foreground">{summary}</p> : null}
      {warning ? <p className="text-xs text-amber-700 dark:text-amber-300">{warning}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {unreadable.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {unreadable.length === 1
              ? "1 document in this library cannot be transcribed from"
              : `${unreadable.length} documents in this library cannot be transcribed from`}
          </summary>
          <ul className="mt-2 space-y-1">
            {unreadable.map((document) => (
              <li key={document.id}>
                <span className="text-foreground">{document.title}</span> — {document.unreadableReason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
