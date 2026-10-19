import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AwardConditionHandoff } from "@/components/grants/award-condition-handoff";
import { awardTermsFixture, handoffId } from "./fixtures/grants/award-handoff";
import type { AwardTerms } from "@/lib/grants/award-handoff";

vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
const awardId=handoffId(1), opportunityId=handoffId(2), r1=handoffId(11), r2=handoffId(12), o1=handoffId(21), o2=handoffId(22);
function history(current:string|null, occurrenceId:string, pending=false) {
  const terms=awardTermsFixture();terms.occurrences=terms.occurrences.slice(0,1);
  return {award:{id:awardId,project_id:handoffId(3),current_handoff_revision_id:current,latest_handoff_revision_id:current??handoffId(10),has_source_backed_issuance:true},history:[{id:current??handoffId(10),sequence:1,terms:{...terms,effective:!pending},proposal:{},receipt:{},created_at:"2026-10-18"}],occurrences:current?[{id:occurrenceId,requirement:terms.occurrences[0],submittal_id:handoffId(31),milestone_id:null,submittal_status:"accepted",submitted_at:"2026-10-18T12:00:00Z",fulfillment_evidence:"Synthetic actual receipt",milestone_status:null,actual_date:null}]:[],invoices:[],legacyObligations:[],application:{},sourceLimits:"Synthetic sources"};
}
function reply(data:unknown,ok=true){return {ok,json:async()=>data};}
function ready(terms:AwardTerms,key=handoffId(50)) {return {reviewed:{schemaVersion:1,requestKey:key,opportunityId,state:{awardId},terms},reviewHash:"synthetic-review-hash"};}
function preparePreview(){
  fireEvent.change(screen.getByLabelText("Actual notice version and effective-source basis"),{target:{value:"Synthetic current effective notice"}});
  fireEvent.click(screen.getByLabelText(/Use this source-confirmed version/));
  fireEvent.click(screen.getByRole("button",{name:"Review handoff"}));
}
beforeEach(()=>{sessionStorage.clear();});

describe("handoff editing reconciliation, prepared and unrun",()=>{
  it("retains an exact stale R1 request until discard, then previews carry from fresh R2/O2",async()=>{
    const oldTerms=awardTermsFixture();oldTerms.occurrences=[{...oldTerms.occurrences[0],disposition:"carry",priorOccurrenceId:o1,fulfillmentStillApplies:true}];
    const retained=ready(oldTerms);sessionStorage.setItem(`award-handoff-pending:${awardId}`,JSON.stringify(retained));
    const previews:AwardTerms[]=[];const applied:string[]=[];
    const fetchMock=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      if(!init?.method){
        const fresh=history(r2,o2);const pendingTerms={...awardTermsFixture(),effective:false,ceiling:"999.99"};
        fresh.award.latest_handoff_revision_id=handoffId(13);
        fresh.history.push({id:handoffId(13),sequence:3,terms:pendingTerms,proposal:{},receipt:{},created_at:"2026-10-18"});
        return reply(fresh);
      }
      const body=JSON.parse(String(init.body));
      if(body.operation==="apply"){applied.push(String(init.body));return reply({error:"Sources/outcomes changed. Review again."},false);}
      previews.push(body.terms);return reply(ready(body.terms));
    });vi.stubGlobal("fetch",fetchMock);
    render(<AwardConditionHandoff awardId={awardId} opportunityId={opportunityId} title="Synthetic award" initiallyOpen/>);
    await screen.findByText(/Current terms/, {exact:false});
    fireEvent.click(screen.getByLabelText(/I checked the actual notice/));
    fireEvent.click(screen.getByRole("button",{name:"Save handoff or recover exact receipt"}));
    await screen.findByText(/exact reviewed request remains retained/);
    expect(JSON.parse(sessionStorage.getItem(`award-handoff-pending:${awardId}`)!)).toEqual(retained);
    expect(JSON.parse(applied[0]).reviewed).toEqual(retained.reviewed);
    fireEvent.click(screen.getByRole("button",{name:"Discard review and reload current sources"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Review handoff"})).toBeEnabled());
    preparePreview();
    await waitFor(()=>expect(previews).toHaveLength(1));
    expect(previews[0].occurrences[0]).toMatchObject({priorOccurrenceId:o2,disposition:"carry",fulfillmentStillApplies:true});
    expect(previews[0].occurrences.some((o)=>o.priorOccurrenceId===o1)).toBe(false);
    expect(previews[0].ceiling).toBe("100.01");
  });

  it("rebases after the first receipt so the next amendment carries the materialized occurrence",async()=>{
    let current=false;const previews:AwardTerms[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
      if(!init?.method)return reply(current?history(r1,o1):history(null,o1,true));
      const body=JSON.parse(String(init.body));
      if(body.operation==="preview"){previews.push(body.terms);return reply(ready(body.terms));}
      current=true;return reply({receipt:{revisionId:r1,sequence:1}});
    }));
    render(<AwardConditionHandoff awardId={awardId} opportunityId={opportunityId} title="Synthetic award" initiallyOpen/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Review handoff"})).toBeEnabled());preparePreview();
    await screen.findByRole("button",{name:"Save handoff or recover exact receipt"});
    fireEvent.click(screen.getByLabelText(/I checked the actual notice/));fireEvent.click(screen.getByRole("button",{name:"Save handoff or recover exact receipt"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Review handoff"})).toBeEnabled());
    expect(sessionStorage.getItem(`award-handoff-pending:${awardId}`)).toBeNull();preparePreview();
    await waitFor(()=>expect(previews).toHaveLength(2));
    expect(previews[0].occurrences[0]).toMatchObject({disposition:"new",priorOccurrenceId:null});
    expect(previews[1].occurrences[0]).toMatchObject({disposition:"carry",priorOccurrenceId:o1});
  });

  it("does not overwrite a retained review when initiallyOpen changes during an outstanding history read",async()=>{
    const retained=ready(awardTermsFixture());sessionStorage.setItem(`award-handoff-pending:${awardId}`,JSON.stringify(retained));
    let resolveRead!:(value:ReturnType<typeof reply>)=>void;
    const fetchMock=vi.fn(()=>new Promise<ReturnType<typeof reply>>((resolve)=>{resolveRead=resolve;}));vi.stubGlobal("fetch",fetchMock);
    const view=render(<AwardConditionHandoff awardId={awardId} opportunityId={opportunityId} title="Synthetic award"/>);
    view.rerender(<AwardConditionHandoff awardId={awardId} opportunityId={opportunityId} title="Synthetic award" initiallyOpen/>);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async()=>resolveRead(reply(history(r2,o2))));
    expect(sessionStorage.getItem(`award-handoff-pending:${awardId}`)).toBe(JSON.stringify(retained));
    expect(screen.getByRole("button",{name:"Save handoff or recover exact receipt"})).toBeInTheDocument();
    expect(screen.getByLabelText("Recorded award ceiling, actual amount")).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
