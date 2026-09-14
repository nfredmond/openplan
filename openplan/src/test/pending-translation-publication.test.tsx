import { createHash } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationWrites } from "@/components/engagement/translation-write-recovery";
import { useTranslationDrafts } from "@/components/engagement/translation-draft-recovery";
import { pendingTranslationSchema, pendingTranslationKey, pendingTranslationWords, retainPendingTranslation, readPendingTranslations,
  clearPendingTranslation, archivePendingTranslation, confirmPendingTranslation, type PendingTranslation } from "@/lib/engagement/pending-translation";
import { readTranslationPublicationSelection, type TranslationPublicationIntent, type TranslationPublicationResult } from "@/lib/engagement/translation-publication";
import type { TranslationGenerationRead } from "@/lib/engagement/translation-generation-request";
import type { TranslationSnapshot } from "@/lib/engagement/translation-snapshot";
const id = (n: number) => `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const scope = { campaignId: id(1), workspaceId: id(2), publisherId: id(4) };
  const generation: TranslationGenerationRead = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: id(3), requestId: id(10), locale: "es", createdAt: "2026-09-13T12:00:00Z", fields: [] };
  // The DTO does not carry publication identity; generation and publication
  // remain distinct actors even when the original actor has lost access.
  generation.fields = ["title", "summary"].map((field, i) => ({ id: id(30+i), address: { entityType: "campaign", entityId: scope.campaignId, field,
    expectedSource: { text: `  Source ${i}  `, sourceLocale: null, available: true }, expectedTranslation: null }, state: "completed", attemptId: id(40+i), failureCode: null,
    output: { status: "completed", text: ` \u00a0Salida ${i}\ufeff `, model: "synthetic-model", sourceHash: hash(`  Source ${i}  `), outputHash: hash(` \u00a0Salida ${i}\ufeff `), deliveryDigest: hash(`delivery-${i}`), acceptedState: "completed" } }));
  const intent: TranslationPublicationIntent = { requestId: id(20), operation: "publish_generated", locale: "es", reason: "SYNTHETIC publication decision",
    entries: generation.fields.map(field => ({ ...structuredClone(field.address), generation: { requestId: generation.requestId, fieldId: field.id, attemptId: field.attemptId!, deliveryDigest: field.output!.deliveryDigest } })) };
  const result: TranslationPublicationResult = { campaignId: scope.campaignId, requestId: intent.requestId, operation: "publish_generated", locale: "es", replayed: false,
    entries: generation.fields.map((field, i) => ({ revision: 1, removed: false, generation: { ...intent.entries[i].generation, actorId: generation.actorId, outputHash: field.output!.outputHash },
      entry: { id: id(50+i), workspace_id: scope.workspaceId, campaign_id: scope.campaignId, entity_type: "campaign", entity_id: scope.campaignId, field: field.address.field, locale: "es",
        translated_text: field.output!.text, source: "machine", machine_model: field.output!.model, source_text_hash: hash(field.address.expectedSource.text!.trim()), created_by: scope.publisherId,
        created_at: "2026-09-13T12:01:00Z", updated_at: "2026-09-13T12:01:00Z" } })) };
  return { scope, generation, intent, result };
}

function publication() {
  const f=fixture();
  f.intent.entries.forEach((entry,i)=>{entry.expectedTranslation={id:f.result.entries[i].entry.id,revision:7};f.generation.fields[i].address.expectedTranslation=structuredClone(entry.expectedTranslation);f.result.entries[i].revision=8;});
  const pending:Extract<PendingTranslation,{retained:unknown}>={version:1,userId:f.scope.publisherId,workspaceId:f.scope.workspaceId,campaignId:f.scope.campaignId,createdAt:"2026-09-13T12:01:00Z",phase:"unconfirmed",intent:f.intent,retained:[f.generation],
    before:f.result.entries.map(({entry})=>({revision:7,entry:{...entry,translated_text:"SYNTHETIC earlier operator wording",source:"operator",machine_model:null}}))};
  return {...f,pending};
}
function snapshot(f:ReturnType<typeof publication>):TranslationSnapshot {
  return {schema:1,campaignId:f.scope.campaignId,campaign:{id:f.scope.campaignId,title:"SYNTHETIC refreshed source",summary:null,public_description:null,default_content_locale:null},categories:[],questions:[],options:[],responses:[],translations:[],counts:{categories:0,questions:0,options:0,responses:0,translations:0}};
}
const confirmed=vi.fn(),reopened=vi.fn();
function Editor({f}:{f:ReturnType<typeof publication>}) {
  const scope={userId:f.pending.userId,workspaceId:f.pending.workspaceId,campaignId:f.pending.campaignId};
  const drafts=useTranslationDrafts(scope);
  const writes=useTranslationWrites({...scope,canWrite:true,onConfirmed:confirmed,onReopen:(pending,current)=>{if(pending)drafts.reopen(pending,current);reopened(pending,current);}});
  return <><button disabled={writes.blocked||writes.busy} onClick={()=>void writes.submit(f.pending)}>Publish viewed output</button>
    <button onClick={()=>drafts.setText(snapshot(f),f.intent.entries[0],"es","SYNTHETIC unrelated unsaved draft")}>Keep manual draft</button>
    <output aria-label="Manual draft count">{drafts.record?.entries.length??0}</output>{writes.recovery}{drafts.recovery}</>;
}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();confirmed.mockClear();reopened.mockClear();});
afterEach(()=>vi.restoreAllMocks());
describe("pending retained publication",()=>{
  it("round-trips exact viewed words, original baseline and both actors",()=>{
    const f=publication();expect(retainPendingTranslation(localStorage,f.pending)).toEqual(f.pending);
    expect(readPendingTranslations(localStorage,f.pending.userId,f.pending.campaignId,f.pending.workspaceId)).toEqual({pending:[f.pending],unreadableKeys:[]});
    expect(pendingTranslationWords(f.pending,0)).toBe(f.generation.fields[0].output!.text);expect(pendingTranslationWords(f.pending,99)).toBeUndefined();
    f.pending.retained[0].fields.reverse();expect(pendingTranslationWords(f.pending,0)).toBe(f.result.entries[0].entry.translated_text);
    f.result.entries.reverse();f.result.replayed=true;expect(confirmPendingTranslation(f.result,f.pending)).toEqual(f.result);
    expect(f.pending.before[0]!.entry.translated_text).toBe("SYNTHETIC earlier operator wording");
  });
  it.each(["missing","request","campaign","workspace","locale","field","attempt","digest","source","baseline","state","output_status","accepted_state","output"])("rejects missing or changed viewed generation %s",kind=>{
    const f=publication(),field=f.pending.retained[0].fields[0];
    if(kind==="missing")Reflect.deleteProperty(f.pending,"retained");
    if(kind==="request")f.pending.retained[0].requestId=id(99);
    if(kind==="campaign")f.pending.retained[0].campaignId=id(99);
    if(kind==="workspace")f.pending.retained[0].workspaceId=id(99);
    if(kind==="locale")f.pending.retained[0].locale="fr";
    if(kind==="field")field.id=id(99);
    if(kind==="attempt")field.attemptId=id(99);
    if(kind==="digest")field.output!.deliveryDigest=hash("changed");
    if(kind==="source")field.address.expectedSource.text="SYNTHETIC refreshed source";
    if(kind==="baseline")field.address.expectedTranslation!.revision=8;
    if(kind==="state")field.state="cancelled";
    if(kind==="output_status")field.output!.status="incomplete";
    if(kind==="accepted_state")field.output!.acceptedState="interrupted";
    if(kind==="output")field.output=null;
    expect(pendingTranslationSchema.safeParse(f.pending).success).toBe(false);
  });
  it.each(["extra_request","duplicate_field"])("refuses ambiguous retained selection %s",kind=>{
    const f=publication();if(kind==="extra_request")f.pending.retained.push({...structuredClone(f.generation),requestId:id(99)});
    else f.pending.retained[0].fields.push(structuredClone(f.pending.retained[0].fields[0]));
    expect(()=>readTranslationPublicationSelection(f.pending,f.pending.intent,f.pending.retained)).toThrow();
  });
  it("keeps damaged publication bytes visible and archives them unchanged",()=>{
    const f=publication(),key=pendingTranslationKey(f.pending);f.pending.retained[0].fields[0].output=null;const raw=JSON.stringify(f.pending);localStorage.setItem(key,raw);
    expect(readPendingTranslations(localStorage,f.pending.userId,f.pending.campaignId,f.pending.workspaceId)).toEqual({pending:[],unreadableKeys:[key]});
    const archived=archivePendingTranslation(localStorage,key,f.pending.userId,f.pending.campaignId)!;expect(localStorage.getItem(archived)).toBe(raw);expect(localStorage.getItem(key)).toBeNull();
  });
  it.each(["words","actor","model","output_hash","baseline_words"])("does not overwrite or clear a frozen publication with changed %s",kind=>{
    const f=publication();retainPendingTranslation(localStorage,f.pending);const changed=structuredClone(f.pending);
    if(kind==="words")changed.retained[0].fields[0].output!.text="Changed viewed words";
    if(kind==="actor")changed.retained[0].actorId=id(99);
    if(kind==="model")changed.retained[0].fields[0].output!.model="changed-model";
    if(kind==="output_hash")changed.retained[0].fields[0].output!.outputHash=hash("changed");
    if(kind==="baseline_words")changed.before[0]!.entry.translated_text="Changed earlier words";
    expect(()=>retainPendingTranslation(localStorage,changed)).toThrow(/different request/);expect(()=>clearPendingTranslation(localStorage,changed)).toThrow(/Another translation payload/);
    expect(JSON.parse(localStorage.getItem(pendingTranslationKey(f.pending))!)).toEqual(f.pending);
  });
  it("confirms against viewed evidence before clearing recovery",async()=>{
    const f=publication(),reply=structuredClone(f.result);reply.entries[0].entry.translated_text="Changed acknowledgement";
    const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify(reply),{status:200}));render(<Editor f={f}/>);
    fireEvent.click(screen.getByRole("button",{name:"Publish viewed output"}));await screen.findByText(/This translation request is unconfirmed/);
    expect(confirmed).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem(pendingTranslationKey(f.pending))!)).toEqual(f.pending);
    f.result.replayed=true;fetch.mockResolvedValueOnce(new Response(JSON.stringify(f.result),{status:200}));fireEvent.click(screen.getByRole("button",{name:"Retry same translation request"}));
    await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(f.intent);
    expect(localStorage.getItem(pendingTranslationKey(f.pending))).toBeNull();expect(screen.getByRole("button",{name:"Publish viewed output"})).toBeEnabled();
  });
  it("retains exact publication after in-flight storage deletion and response loss",async()=>{
    const f=publication();let fail!:(error:Error)=>void;const fetch=vi.spyOn(globalThis,"fetch").mockImplementationOnce(()=>new Promise<Response>((_,reject)=>{fail=reject;}));render(<Editor f={f}/>);
    fireEvent.click(screen.getByRole("button",{name:"Publish viewed output"}));await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());localStorage.removeItem(pendingTranslationKey(f.pending));act(()=>window.dispatchEvent(new StorageEvent("storage")));
    await act(async()=>fail(new Error("SYNTHETIC lost publication response")));expect(screen.getByRole("button",{name:"Publish viewed output"})).toBeDisabled();
    expect(screen.getAllByText(/Wording in this request:/)[0].parentElement!.textContent).toContain(f.generation.fields[0].output!.text);
    f.result.replayed=true;fetch.mockResolvedValueOnce(new Response(JSON.stringify(f.result),{status:200}));fireEvent.click(screen.getByRole("button",{name:"Retry same translation request"}));await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);
  });
  it("preserves refused generated words in the archive without rebasing a manual draft",async()=>{
    const f=publication();const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({kind:"conflict"}),{status:409}));render(<Editor f={f}/>);
    fireEvent.click(screen.getByRole("button",{name:"Keep manual draft"}));expect(screen.getByLabelText("Manual draft count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button",{name:"Publish viewed output"}));await screen.findByRole("button",{name:"Review current saved translations"});
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({snapshot:snapshot(f)}),{status:200}));fireEvent.click(screen.getByRole("button",{name:"Review current saved translations"}));await screen.findByRole("button",{name:"Keep this copy and reopen editor"});
    fireEvent.click(screen.getByRole("button",{name:"Keep this copy and reopen editor"}));expect(reopened).toHaveBeenCalledOnce();
    const archived=Object.keys(localStorage).filter(key=>key.startsWith("openplan:translation-archive:"));expect(archived).toHaveLength(1);expect(JSON.parse(localStorage.getItem(archived[0])!).retained).toEqual(f.pending.retained);
    expect(screen.getAllByText(/Requested wording:/)[0].parentElement!.textContent).toContain(f.generation.fields[0].output!.text);
    expect(screen.getByLabelText("Manual draft count")).toHaveTextContent("1");expect(screen.getByText("SYNTHETIC unrelated unsaved draft")).toBeInTheDocument();
  });
});
