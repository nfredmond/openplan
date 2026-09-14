"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SynthesisSourceSnapshot } from "@/lib/engagement/synthesis-sources";
import { prepareSynthesisSource, type SynthesisPreparationGroup } from "@/lib/engagement/synthesis-preparation";

const contextLabels = {
  retained: "Historical definition retained", uncategorized: "Uncategorized",
  definition_unavailable: "Historical definition unavailable", question_unavailable: "Historical question unavailable",
  category_unavailable: "Historical category unavailable",
};
const groupLabel = (group: SynthesisPreparationGroup) => group.label ?? contextLabels[group.context];

/** Inspect original captured text and definitions, never current campaign labels. */
export function SynthesisSourceInspection({ snapshot, sha256 }: { snapshot: SynthesisSourceSnapshot; sha256: string }) {
  const [search, setSearch] = useState(""), [page, setPage] = useState(0);
  const [groupId, setGroupId] = useState("");
  const preparation = useMemo(() => prepareSynthesisSource(snapshot, sha256), [snapshot, sha256]);
  const groups = useMemo(() => [
    ...preparation.categoryGroups.map((group, index) => ({ group, value: `category:${index}`, kind: "Category" })),
    ...preparation.questionGroups.map((group, index) => ({ group, value: `question:${index}`, kind: "Question" })),
  ], [preparation]);
  const selectedGroup = groups.find(entry => entry.value === groupId)?.group;
  const members = useMemo(() => selectedGroup ? new Set<string>(selectedGroup.sourceIds) : null, [selectedGroup]);
  const rows = useMemo(() => {
    const categoryLabels = new Map(preparation.categoryGroups.flatMap(group => group.sourceIds.map(id => [id, groupLabel(group)] as const)));
    const comments = snapshot.items.map(item => ({ id: `item:${item.id}`, kind: item.parent_item_id ? "Reply" : "Comment", title: item.title,
      label: categoryLabels.get(`item:${item.id}`) ?? "Historical category unavailable",
      text: item.body, status: item.status, createdAt: item.created_at, retained: item,
    }));
    const sessions = new Map(snapshot.sessions.map(session => [session.id, session]));
    const answers = snapshot.answers.map(answer => ({ id: `answer:${answer.id}`, kind: "Survey answer", title: answer.question_prompt_snapshot,
      label: answer.question_type.replaceAll("_", " "), text: answer.answer_text ?? "Typed answer retained below; interpretation has not been assessed.",
      status: sessions.get(answer.session_id)?.status, createdAt: sessions.get(answer.session_id)?.created_at, retained: answer,
    }));
    return [...comments, ...answers];
  }, [snapshot, preparation]);
  const filtered = useMemo(() => rows.filter(row => (!members || members.has(row.id)) && `${row.kind} ${row.title ?? ""} ${row.label} ${row.text} ${JSON.stringify(row.retained)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [rows, search, members]);
  return <article className="rounded border p-4 space-y-4" aria-label="Saved source inspection">
    <h3 className="font-semibold">Saved source: {snapshot.campaign.title}</h3>
    <p>{new Date(snapshot.capturedAt).toLocaleString()} · Private staff copy</p>
    <p>{snapshot.counts.items} of {snapshot.counts.campaignItems} comments received; {snapshot.counts.sessions} of {snapshot.counts.campaignSessions} survey responses; {snapshot.counts.answers} of {snapshot.counts.campaignAnswers} answers retained.</p>
    <p className="text-sm">Scope: {snapshot.selection.statuses.join(", ")}. Comments {snapshot.selection.includeItems ? "included" : "excluded"}; surveys {snapshot.selection.includeSurveys ? "included" : "excluded"}. These counts describe contributions, not distinct people or representative support.</p>
    <p className="break-words text-xs">Category IDs: {snapshot.selection.categoryIds.join(", ") || "all"}. Received from {snapshot.selection.from ?? "no start"} to {snapshot.selection.to ?? "no end"}, end exclusive.</p>
    <p className="break-all text-xs">Source SHA256: {sha256}</p>
    <section aria-label="Complete source preparation" className="rounded border p-3 space-y-3 min-w-0">
      <h4 className="font-semibold">Complete source preparation</h4>
      <p>{preparation.counts.contributions} contributions accounted for: {preparation.counts.comments} comments, {preparation.counts.replies} replies and {preparation.counts.answers} survey answers.</p>
      <p>{preparation.counts.sessionsWithoutSelectedAnswers} retained survey responses have no selected answers. Response counts do not identify distinct people.</p>
      <p className="text-sm">Free local grouping by historical category and question. Themes, sentiment, typed-answer interpretation and representative support are not assessed. This preparation is computed from the saved source; it is not a saved staff review.</p>
      <label className="block">Inspect a prepared group
        <select className="block w-full min-w-0 max-w-full rounded border p-2" value={groupId} onChange={event => { setGroupId(event.target.value); setSearch(""); setPage(0); }}>
          <option value="">All {preparation.counts.contributions} contributions</option>
          {groups.map(({ group, value, kind }) => <option key={value} value={value}>{kind}: {groupLabel(group)} · {group.sourceIds.length} contributions · version {group.versionId?.slice(0, 8) ?? "unavailable"}</option>)}
        </select>
      </label>
      {selectedGroup ? <div className="text-sm space-y-1 break-words">
        <p>{groupLabel(selectedGroup)}: {selectedGroup.sourceIds.length} contributions. {contextLabels[selectedGroup.context]}.</p>
        <p>Historical version: {selectedGroup.versionId ?? "unavailable"}. {selectedGroup.questionType ? `Question type: ${selectedGroup.questionType}.` : ""}</p>
        <details><summary>Complete group membership</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{selectedGroup.sourceIds.join("\n")}</pre></details>
      </div> : null}
    </section>
    <label className="block">Search all retained contributions<input type="search" className="block w-full rounded border p-2" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
    <p>{filtered.length} matching contributions. Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}.</p>
    <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous source page</Button><Button type="button" variant="outline" disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(page + 1)}>Next source page</Button></div>
    {filtered.slice(page * 25, (page + 1) * 25).map(row => <article key={row.id} className="rounded border p-3 space-y-2">
      <h4 className="font-semibold break-words">{row.kind}: {row.title ?? row.label}</h4><p className="text-xs break-words">{row.label} · {row.status} · {row.createdAt}</p>
      <p className="whitespace-pre-wrap break-words">{row.text}</p>
      <details><summary>Exact retained fields</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(row.retained, null, 2)}</pre></details>
    </article>)}
    <p className="text-xs">The retained fields include original typed values and mapped locations when available. Attachment contents and spatial interpretation are not assessed by this inspection.</p>
  </article>;
}
