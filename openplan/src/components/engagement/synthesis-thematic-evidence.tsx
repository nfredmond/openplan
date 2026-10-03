"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SynthesisReviewContent } from "@/lib/engagement/synthesis-review";
import type { SynthesisSourceSnapshot } from "@/lib/engagement/synthesis-sources";
import { inspectThematicPreview, type ThematicBrowserScope, type ThematicProposalDisplay } from "@/lib/engagement/synthesis-thematic-browser";

type Origin = NonNullable<SynthesisReviewContent["machineOrigin"]>;
type Props = { origin: Origin; proposal: ThematicProposalDisplay; snapshot: SynthesisSourceSnapshot };

/** Present machine claims beside their retained context and the original contribution. */
export function SynthesisThematicEvidence({ origin, proposal, snapshot }: Props) {
  const [selected, setSelected] = useState<string | null>(null), [search, setSearch] = useState(""), [page, setPage] = useState(0);
  const selectedRef = useRef<HTMLElement>(null);
  function downloadOriginal(kind: "proposal" | "history") {
    const text = kind === "proposal" ? origin.proposalText : origin.historyText;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `thematic-${kind}-${origin.reference.requestId}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => { if (selected) selectedRef.current?.focus(); }, [selected]);
  const contributions = useMemo(() => [
    ...snapshot.items.map((row, index) => ({ id: `item:${row.id}`, label: `${row.parent_item_id ? "Reply" : "Comment"} ${index + 1}`, prompt: null, text: row.body })),
    ...snapshot.answers.map((row, index) => ({ id: `answer:${row.id}`, label: `Survey answer ${index + 1}`,
      prompt: row.question_prompt_snapshot ?? "Historical question wording unavailable", text: row.answer_text ?? JSON.stringify(row.answer_json, null, 2) })),
  ], [snapshot]);
  const byId = new Map(contributions.map(row => [row.id, row])), contexts = new Map(proposal.contextEvidence.map(row => [row.sourceId, row]));
  const filtered = contributions.filter(row => `${row.label} ${row.prompt ?? ""} ${row.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const contribution = selected ? byId.get(selected) : null, context = selected ? contexts.get(selected) : null;
  const sourceButton = (sourceId: string) => <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal"
    onClick={() => setSelected(sourceId)}>Inspect {byId.get(sourceId)?.label.toLocaleLowerCase() ?? "referenced contribution"}</Button>;
  return <section aria-label="Original machine proposal evidence" className="min-w-0 space-y-4 rounded border p-3">
    <h5 className="font-semibold">Original machine proposal</h5>
    <p className="text-sm">Machine-generated, unreviewed wording. Citations identify retained evidence; they do not establish that the interpretation is accurate. Counts describe contributions, not distinct people or representative support.</p>
    <p className="font-medium break-words">{proposal.title}</p>
    <p className="whitespace-pre-wrap break-words">{proposal.notes || "No machine notes were supplied."}</p>
    <p>{proposal.assignedSourceCount} assigned contributions; {proposal.unassignedSourceIds.length} unassigned; {proposal.overlappingSourceCount} appear in more than one group.</p>
    <section aria-label="Machine proposal uncertainty" className="space-y-2">
      <h6 className="font-semibold">Thematic uncertainty</h6>
      {proposal.thematicUncertainties.length ? <ul className="list-disc pl-5 space-y-1">{proposal.thematicUncertainties.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text}</li>)}</ul>
        : <p>No thematic uncertainty was reported by the model. This is not evidence that uncertainty is absent.</p>}
      <p className="text-sm">Earlier contextual uncertainty remains with each contribution below.</p>
    </section>
    <div className="space-y-2">{proposal.groups.map(group => <details key={group.id} className="rounded border p-3">
      <summary className="break-words">{group.label} · {group.sourceIds.length} contributions · machine sentiment: {group.sentiment.replaceAll("_", " ")}</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{group.summary || "No machine summary was supplied."}</p>
      <ul className="mt-3 space-y-3">{group.members.map(member => <li key={member.sourceId} className="space-y-2">
        {sourceButton(member.sourceId)}<p className="whitespace-pre-wrap break-words">Machine membership rationale: {member.rationale}</p>
        {member.citations.map((citation, index) => <blockquote key={index} className="border-l-2 pl-3 whitespace-pre-wrap break-words">
          <p>“{citation.quote}”</p><p className="text-xs">From retained machine context note {citation.noteId + 1}. Inspect the original contribution before relying on it.</p>
        </blockquote>)}
      </li>)}</ul>
    </details>)}</div>
    <details className="rounded border p-3"><summary>Unassigned contributions and machine reasons ({proposal.unassigned.length})</summary>
      <ul className="mt-3 space-y-3">{proposal.unassigned.map(member => <li key={member.sourceId} className="space-y-2">
        {sourceButton(member.sourceId)}<p className="whitespace-pre-wrap break-words">{member.reason}</p>
        {member.citations.map((citation, index) => <blockquote key={index} className="border-l-2 pl-3 whitespace-pre-wrap break-words">“{citation.quote}”<p className="text-xs">Retained machine context note {citation.noteId + 1}.</p></blockquote>)}
      </li>)}</ul>
    </details>
    <section aria-label="Browse original contributions" className="space-y-3">
      <h6 className="font-semibold">Original contributions and retained context</h6>
      <label className="block">Find a contribution<input type="search" className="block w-full min-w-0 rounded border p-2" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
      <p>{filtered.length} matching contributions. Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 20))}.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous contributions</Button>
        <Button type="button" variant="outline" disabled={(page + 1) * 20 >= filtered.length} onClick={() => setPage(page + 1)}>Next contributions</Button></div>
      <ul className="flex flex-wrap gap-2">{filtered.slice(page * 20, (page + 1) * 20).map(row => <li key={row.id}>{sourceButton(row.id)}</li>)}</ul>
    </section>
    {selected ? <section ref={selectedRef} tabIndex={-1} aria-label="Selected contribution evidence" className="rounded border p-3 space-y-3 outline-offset-4">
      <h6 className="font-semibold">{contribution?.label ?? "Referenced contribution unavailable"}</h6>
      {contribution?.prompt ? <p className="whitespace-pre-wrap break-words">Historical question: {contribution.prompt}</p> : null}
      <p className="whitespace-pre-wrap break-words">{contribution?.text ?? "The original contribution is not available in this saved source."}</p>
      <h6 className="font-semibold">Earlier machine context</h6>
      {context ? <><ol className="list-decimal pl-5 space-y-2">{context.notes.map(note => <li key={note.id} className="whitespace-pre-wrap break-words">{note.text}</li>)}</ol>
        {!context.notes.length ? <p>No contextual notes were retained.</p> : null}
        <p className="font-medium">Retained contextual uncertainty</p>
        {context.uncertainties.length ? <ul className="list-disc pl-5 space-y-2">{context.uncertainties.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text}</li>)}</ul> : <p>No contextual uncertainty was reported. This does not establish certainty.</p>}
        <details><summary>Original context references</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(context, null, 2)}</pre></details>
      </> : <p>Retained context is unavailable for this contribution.</p>}
    </section> : null}
    <div className="flex flex-wrap gap-3">
      <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => downloadOriginal("proposal")}>Download original proposal JSON</Button>
      <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => downloadOriginal("history")}>Download original history JSON</Button>
    </div>
    <details><summary>Original evidence references and bytes</summary>
      <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(origin.reference, null, 2)}</pre>
      <details><summary>Complete original proposal text</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{origin.proposalText}</pre></details>
      <details><summary>Complete original history text</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{origin.historyText}</pre></details>
    </details>
  </section>;
}

/** Retained review corrections do not replace or reclassify their original machine evidence. */
export function RetainedThematicEvidence({ origin, scope, snapshot }: { origin: Origin; scope: ThematicBrowserScope; snapshot: SynthesisSourceSnapshot }) {
  const { campaignId, workspaceId, sourceId, sourceSha256 } = scope;
  const scopeKey = `${campaignId}:${workspaceId}:${sourceId}:${sourceSha256}`;
  const [result, setResult] = useState<{ origin: Origin; snapshot: SynthesisSourceSnapshot; scopeKey: string; proposal: ThematicProposalDisplay | null; error: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    const selectedScope = { campaignId, workspaceId, sourceId, sourceSha256 };
    void inspectThematicPreview({ ...selectedScope, requestId: origin.reference.requestId, status: "proposal_complete",
      selectionSequence: origin.reference.selectionSequence, cancelled: false, origin }, selectedScope, origin.reference.requestId, snapshot)
      .then(value => { if (active) setResult({ origin, snapshot, scopeKey, proposal: value.proposal, error: null }); })
      .catch(() => { if (active) setResult({ origin, snapshot, scopeKey, proposal: null, error: "Original machine evidence could not be inspected. Reopen the saved review before relying on it." }); });
    return () => { active = false; };
  }, [origin, campaignId, workspaceId, sourceId, sourceSha256, snapshot, scopeKey]);
  if (!result || result.origin !== origin || result.snapshot !== snapshot || result.scopeKey !== scopeKey) return <p role="status">Checking retained original machine evidence.</p>;
  if (!result.proposal || result.error) return <p role="alert">{result.error}</p>;
  return <><p className="text-sm">This revision retains an imported machine proposal. Later staff corrections and approvals remain separate from the original wording below.</p>
    <SynthesisThematicEvidence origin={origin} proposal={result.proposal} snapshot={snapshot} /></>;
}
