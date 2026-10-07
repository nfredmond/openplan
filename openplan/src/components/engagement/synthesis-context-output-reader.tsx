"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { synthesisContextOutputSchema } from "@/lib/engagement/synthesis-context-output";

/** Display the original machine notes and uncertainties without letting coverage
 * identifiers consume the reading view. The source JSON remains downloadable.
 */
export function SynthesisContextOutputReader({ outputText, contextRequestId, outputSha256 }: { outputText: string; contextRequestId: string; outputSha256: string }) {
  return <Reader key={`${contextRequestId}:${outputSha256}`} outputText={outputText} contextRequestId={contextRequestId} />;
}
function Reader({ outputText, contextRequestId }: { outputText: string; contextRequestId: string }) {
  const output = useMemo(() => synthesisContextOutputSchema.parse(JSON.parse(outputText)), [outputText]);
  const [noteLimit, setNoteLimit] = useState(20), [uncertaintyLimit, setUncertaintyLimit] = useState(20);
  return <div className="min-w-0 space-y-3 text-sm">
    <p className="font-medium">Completed context, machine wording not reviewed</p>
    <p>This wording needs staff review. Choosing it for theme preparation does not approve its meaning.</p>
    <h6 className="font-semibold">Generated notes ({output.notes.length.toLocaleString("en-US")})</h6>
    {output.notes.length === 0 ? <p>No context notes were generated. This does not establish that the contribution raises no issues.</p> : null}
    <ol className="space-y-3">{output.notes.slice(0, noteLimit).map(note => <li key={note.id} className="min-w-0 space-y-1">
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.text}</p>
      <details><summary className="cursor-pointer">Source quotations for note {note.id}</summary>
        {note.citations.map((citation, index) => <blockquote key={index} className="my-2 border-l border-border pl-3">
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{citation.quote}</p>
          <p className="break-all font-mono text-xs">Source part {citation.partId}</p>
        </blockquote>)}
        {note.relatedNoteIds.length ? <p>Related notes: {note.relatedNoteIds.join(", ")}</p> : null}
      </details>
    </li>)}</ol>
    {output.notes.length > noteLimit ? <><p>Showing {noteLimit} of {output.notes.length} generated notes.</p>
      <Button type="button" variant="outline" onClick={() => setNoteLimit(value => value + 20)}>Show more context notes</Button></> : null}
    <h6 className="font-semibold">Reported uncertainties ({output.uncertainties.length.toLocaleString("en-US")})</h6>
    {output.uncertainties.length === 0 ? <p>The machine reported no uncertainties. Staff still need to check the original contribution.</p> : null}
    <ul className="space-y-2">{output.uncertainties.slice(0, uncertaintyLimit).map((text, index) => <li key={index} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</li>)}</ul>
    {output.uncertainties.length > uncertaintyLimit ? <><p>Showing {uncertaintyLimit} of {output.uncertainties.length} reported uncertainties.</p>
      <Button type="button" variant="outline" onClick={() => setUncertaintyLimit(value => value + 20)}>Show more uncertainties</Button></> : null}
    <Button type="button" variant="outline" onClick={() => {
      const url = URL.createObjectURL(new Blob([outputText], { type: "application/json" })), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `openplan-context-${contextRequestId}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download complete context</Button>
    <p>The private file preserves the original machine output and source references. It is not an approved finding.</p>
  </div>;
}
