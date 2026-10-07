import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import { planContextSaveSchema } from "@/lib/land-use-plans/plan-context-command";
import { LandUsePlanContextEditor } from "@/components/land-use-plans/land-use-plan-context-editor";
import { contextCommandFromDraft, planContextDraft } from "@/lib/land-use-plans/plan-context-draft";
import { serializePlanContextSave } from "@/lib/land-use-plans/plan-context-command";
import { clearOwnedPlanContextDraft, makePlanContextDraft, readPlanContextRecovery, retainPlanContextCommand, retainPlanContextDraft,
  type PlanContextRead, type PendingPlanContext } from "@/lib/land-use-plans/plan-context-recovery";
import type { SavedPlanContext } from "@/lib/land-use-plans/plan-context";
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => <div>Study area picker</div> }));
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope = { actorId:id(1),workspaceId:id(2),planId:id(3) };
const base = { versionId:id(4),contextHash:"a".repeat(64),descriptorId:"local-unconfigured",planKindKey:"general" };
const context: SavedPlanContext = { schemaVersion:1,savedBy:scope.actorId,savedAt:"2026-10-07T00:00:00Z",
  place:{ source:"drawn",kind:null,ref:null,label:"Synthetic study area",countryCode:null,subdivisionCode:null,bbox:{minLon:0,minLat:0,maxLon:1,maxLat:1},geometry:{type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,0]]] }},
  assessment:{authorities:[{id:id(5),label:"Synthetic planning body",role:"Study sponsor",kind:"unassessed",jurisdiction:null,sourceUrls:[]}],applicability:{status:"unresolved",explanation:"Scope remains unassessed."}} };
const draft = planContextDraft(context,{authority:"",geography:""});
const command = contextCommandFromDraft(draft,{versionId:base.versionId,expectedContextHash:base.contextHash,descriptorId:base.descriptorId,planKindKey:base.planKindKey,commandId:id(6)});
const pending: PendingPlanContext = {...scope,schemaVersion:1,kind:"pending",savedAt:context.savedAt,base,draft,commandText:` \n${serializePlanContextSave(command)}\n`,retainedPlace:context.place};
const props = {...scope, activeVersionId:base.versionId,draftRevision:7,workingVersionId:base.versionId,descriptorId:base.descriptorId,planKindKey:base.planKindKey,working:true,canWrite:true,disabled:false,
  authorityLabel:"Inherited display label",geographyLabel:"Inherited display area",onRefresh:vi.fn<()=>Promise<void>>(),onBlockChange:vi.fn<(scope:string,blocked:boolean)=>void>()};
let current: PlanContextRead, transport: ReturnType<typeof vi.fn<typeof fetch>>, posts: string[];
const saveButton = () => screen.getByRole("button",{name:"Save plan context"});
const bodyField = () => screen.getByLabelText("Body name");
const edit = (name="Revised planning body") => fireEvent.change(bodyField(),{target:{value:name}});
const blocked = () => props.onBlockChange.mock.calls.at(-1)?.[1];
function response(body:string,replayed=false) {
  const command=JSON.parse(body);
  const saved={...context,assessment:command.assessment};
  current={...current,contextState:{status:"retained",context:saved},contextHash:"b".repeat(64)};
  return Response.json({replayed,context:saved,contextHash:current.contextHash,commandId:command.commandId,versionId:command.versionId},{status:replayed?200:201});
}
async function ready() { await waitFor(()=>expect(bodyField()).toBeEnabled()); }
beforeEach(()=>{
  localStorage.clear(); posts=[]; props.onRefresh.mockReset().mockResolvedValue();props.onBlockChange.mockReset();
  current={...scope,...base,contextState:{status:"retained",context},canWrite:true};
  transport=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{
    if(init?.method==="POST") { posts.push(String(init.body));return response(String(init.body)); }
    return Response.json(current);
  });vi.stubGlobal("fetch",transport);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
describe("plan context editor",()=>{
  it("retains an edited draft and command before transport, then refreshes before enabling freeze",async()=>{
    let finishRefresh!:()=>void;props.onRefresh.mockImplementation(()=>new Promise(resolve=>{finishRefresh=resolve;}));
    transport.mockImplementation(async(_url,init)=>{
      if(init?.method!=="POST") return Response.json(current);
      const records=readPlanContextRecovery(localStorage,scope);
      expect(records.filter(r=>r.value?.kind==="draft")).toHaveLength(1);
      expect(records.find(r=>r.value?.kind==="pending")?.value).toMatchObject({commandText:init.body});
      posts.push(String(init.body));return response(String(init.body));
    });
    render(<LandUsePlanContextEditor {...props}/>);await ready();expect(blocked()).toBe(false);
    edit();expect(blocked()).toBe(true);expect(readPlanContextRecovery(localStorage,scope)[0].value).toMatchObject({kind:"draft",draft:{authorities:[{label:"Revised planning body"}]}});
    fireEvent.click(saveButton());await waitFor(()=>expect(props.onRefresh).toHaveBeenCalledTimes(1));
    expect(posts).toHaveLength(1);expect(saveButton()).toBeDisabled();expect(blocked()).toBe(true);
    expect(readPlanContextRecovery(localStorage,scope).some(r=>r.value?.kind==="pending")).toBe(true);
    await act(async()=>finishRefresh());await screen.findByText("Plan context saved and refreshed.");
    expect(blocked()).toBe(false);expect(readPlanContextRecovery(localStorage,scope)).toEqual([]);expect(bodyField()).toHaveValue("Revised planning body");
  });
  it("keeps an unknown save for explicit exact retry, including duplicate clicks and reload",async()=>{
    let fail!:(error:Error)=>void;
    transport.mockImplementation(async(_url,init)=>{
      if(init?.method!=="POST") return Response.json(current);
      posts.push(String(init.body));return new Promise((_resolve,reject)=>{fail=reject;});
    });
    const view=render(<LandUsePlanContextEditor {...props}/>);await ready();edit();fireEvent.click(saveButton());fireEvent.click(saveButton());
    expect(posts).toHaveLength(1);await act(async()=>fail(new Error("Lost reply")));
    expect(screen.getByRole("alert")).toHaveTextContent("Lost reply");expect(blocked()).toBe(true);expect(bodyField()).toBeDisabled();
    const original=posts[0];view.unmount();render(<LandUsePlanContextEditor {...props}/>);
    await screen.findByRole("button",{name:"Retry exact save request"});act(()=>window.dispatchEvent(new StorageEvent("storage")));expect(posts).toHaveLength(1);
    transport.mockImplementation(async(_url,init)=>{if(init?.method!=="POST")return Response.json(current);posts.push(String(init.body));return response(String(init.body),true);});
    fireEvent.click(screen.getByRole("button",{name:"Retry exact save request"}));await screen.findByText("Plan context saved and refreshed.");
    expect(posts).toEqual([original,original]);
    // The earlier tab's mutable draft remains available; recovery cannot erase it.
    expect(readPlanContextRecovery(localStorage,scope).filter(r=>!r.archived).map(r=>r.value?.kind)).toEqual(["draft"]);expect(blocked()).toBe(true);
  });
  it("retains confirmation and both copies when the workbench refresh fails",async()=>{
    props.onRefresh.mockRejectedValue(new Error("workbench read failed"));
    render(<LandUsePlanContextEditor {...props}/>);await ready();edit();fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("The save is confirmed");expect(blocked()).toBe(true);expect(bodyField()).toHaveValue("Revised planning body");
    expect(readPlanContextRecovery(localStorage,scope).map(r=>r.value?.kind).sort()).toEqual(["draft","pending"]);expect(saveButton()).toBeDisabled();
  });
  it("keeps wrong-account and malformed reads distinct from historical absence",async()=>{
    transport.mockResolvedValue(Response.json({...current,actorId:id(20)}));render(<LandUsePlanContextEditor {...props}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("another account");expect(screen.queryByLabelText("Body name")).not.toBeInTheDocument();expect(blocked()).toBe(true);expect(posts).toEqual([]);
  });
  it("starts historical context with display labels and no inferred legal facts",async()=>{
    current={...current,contextState:{status:"legacy"},contextHash:null};render(<LandUsePlanContextEditor {...props}/>);await ready();
    expect(bodyField()).toHaveValue("Inherited display label");expect(screen.getByLabelText("Role in this plan")).toHaveValue("");expect(screen.getByLabelText("Type of body")).toHaveValue("");
    expect(screen.getByLabelText("Jurisdiction is not assessed")).toBeChecked();expect(screen.queryByLabelText("Keep the saved plan area unchanged")).not.toBeInTheDocument();
  });
  it("keeps draft text and a downloadable copy when browser retention fails",async()=>{
    render(<LandUsePlanContextEditor {...props}/>);await ready();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota full");});edit();
    expect(screen.getByRole("alert")).toHaveTextContent("quota full");expect(bodyField()).toHaveValue("Revised planning body");expect(blocked()).toBe(true);
    fireEvent.click(saveButton());expect(posts).toEqual([]);expect(screen.getByRole("button",{name:"Download this draft"})).toBeEnabled();
  });
  it("keeps restored stale bases until staff review and preserves the old copy during rebase",async()=>{
    const old=makePlanContextDraft(scope,{...base,versionId:id(20),contextHash:"c".repeat(64)}, {...draft,authorities:[{...draft.authorities[0],label:"Older reviewed body"}]},id(10));
    retainPlanContextDraft(localStorage,old,null);render(<LandUsePlanContextEditor {...props}/>);await ready();
    fireEvent.click(screen.getByRole("button",{name:"Open draft copy"}));expect(bodyField()).toHaveValue("Older reviewed body");expect(saveButton()).toBeDisabled();
    const own=readPlanContextRecovery(localStorage,scope).find(r=>r.value?.kind==="draft"&&r.value.instanceId!==old.instanceId)!;
    expect(own.value?.base).toEqual(old.base);expect(posts).toEqual([]);
    expect(screen.getByRole("button",{name:"Use reviewed assessment with current draft"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Use reviewed assessment with current draft"}));expect(readPlanContextRecovery(localStorage,scope).find(r=>r.key===own.key)?.value?.base).toEqual(old.base);
    fireEvent.click(screen.getByLabelText("I reviewed the saved context, responsible bodies and selected plan area."));
    fireEvent.click(screen.getByRole("button",{name:"Use reviewed assessment with current draft"}));
    expect(saveButton()).toBeEnabled();expect(posts).toEqual([]);const copies=readPlanContextRecovery(localStorage,scope);
    expect(copies.some(r=>r.archived&&r.raw===own.raw)).toBe(true);expect(copies.find(r=>!r.archived&&r.value?.kind==="draft"&&r.value.instanceId!==old.instanceId)?.value?.base).toEqual(base);
    expect(bodyField()).toHaveValue("Older reviewed body");expect(screen.getByLabelText("Keep the saved plan area unchanged")).toBeChecked();
  });
  it("keeps proposed replacement geometry only through the explicit reviewed choice",async()=>{
    const old=makePlanContextDraft(scope,{...base,contextHash:"c".repeat(64)},{...draft,place:{...draft.place,mode:"uploaded",label:"Proposed area"}},id(10));
    retainPlanContextDraft(localStorage,old,null);render(<LandUsePlanContextEditor {...props}/>);await ready();fireEvent.click(screen.getByRole("button",{name:"Open draft copy"}));
    fireEvent.change(screen.getByLabelText("Plan area for the reviewed draft"),{target:{value:"proposed"}});
    fireEvent.click(screen.getByLabelText("I reviewed the saved context, responsible bodies and selected plan area."));fireEvent.click(screen.getByRole("button",{name:"Use reviewed assessment with current draft"}));
    expect(screen.getByLabelText("Plan area label")).toHaveValue("Proposed area");expect(saveButton()).toBeEnabled();expect(posts).toEqual([]);
  });
  it("preserves the edited draft before replacing it with the current saved context",async()=>{
    render(<LandUsePlanContextEditor {...props}/>);await ready();edit();const record=readPlanContextRecovery(localStorage,scope)[0];
    fireEvent.click(screen.getByRole("button",{name:"Keep draft copy and use saved context"}));
    await screen.findByText("The earlier draft is preserved. This form starts from the current saved context.");
    expect(bodyField()).toHaveValue("Synthetic planning body");expect(readPlanContextRecovery(localStorage,scope)).toEqual([{...record,key:expect.stringContaining(":copy:"),archived:true}]);expect(blocked()).toBe(false);expect(posts).toEqual([]);
  });
  it("keeps malformed copies downloadable and refuses a new save until they are preserved",async()=>{
    localStorage.setItem(`openplan:plan-context:${scope.actorId}:${scope.workspaceId}:${scope.planId}:pending:${id(30)}`,"{unreadable");
    render(<LandUsePlanContextEditor {...props}/>);await screen.findByText("Unreadable copy");await screen.findByText("Current saved context");expect(blocked()).toBe(true);expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button",{name:"Keep copy aside and refresh"}));await waitFor(()=>expect(blocked()).toBe(false));
    expect(readPlanContextRecovery(localStorage,scope)[0]).toMatchObject({raw:"{unreadable",archived:true,value:null});
  });
  it("permits exact request recovery after freezing but refuses new edits",async()=>{
    retainPlanContextCommand(localStorage,pending);current={...current,versionId:null};render(<LandUsePlanContextEditor {...props} working={false} workingVersionId={null}/>);
    await screen.findByRole("button",{name:"Retry exact save request"});expect(screen.queryByRole("button",{name:"Save plan context"})).not.toBeInTheDocument();
    transport.mockImplementation(async(_url,init)=>{if(init?.method!=="POST")return Response.json(current);posts.push(String(init.body));return response(String(init.body),true);});
    fireEvent.click(screen.getByRole("button",{name:"Retry exact save request"}));await screen.findByText("Plan context saved and refreshed.");expect(posts).toEqual([pending.commandText]);
  });
  it("refuses new edits for mismatched working versions and read-only staff",async()=>{
    const view=render(<LandUsePlanContextEditor {...props} workingVersionId={id(20)}/>);await screen.findByLabelText("Body name");expect(bodyField()).toBeDisabled();expect(blocked()).toBe(true);
    view.rerender(<LandUsePlanContextEditor {...props} canWrite={false}/>);expect(bodyField()).toBeDisabled();fireEvent.click(saveButton());expect(posts).toEqual([]);
  });
  it("aborts old-account requests and preserves their copies after a scope change",async()=>{
    let finish!:(value:Response)=>void;let requestSignal:AbortSignal|null|undefined;
    transport.mockImplementation(async(_url,init)=>{if(init?.method!=="POST")return Response.json(current);posts.push(String(init.body));requestSignal=init.signal;return new Promise(resolve=>{finish=resolve;});});
    const view=render(<LandUsePlanContextEditor {...props}/>);await ready();edit();fireEvent.click(saveButton());
    current={...current,actorId:id(40)};view.rerender(<LandUsePlanContextEditor {...props} actorId={id(40)}/>);
    expect(requestSignal?.aborted).toBe(true);await act(async()=>finish(response(posts[0])));expect(props.onRefresh).not.toHaveBeenCalled();
    expect(readPlanContextRecovery(localStorage,scope).some(r=>r.value?.kind==="pending")).toBe(true);expect(readPlanContextRecovery(localStorage,{...scope,actorId:id(40)})).toEqual([]);
    expect(screen.queryByText("Plan context saved and refreshed.")).not.toBeInTheDocument();
  });
  it("does not let delayed restore files replace newer typing or cross a scope change",async()=>{
    const old=makePlanContextDraft(scope,base,{...draft,authorities:[{...draft.authorities[0],label:"Old file body"}]},id(10));
    let finish!:(raw:string)=>void;const file=new File(["x"],"draft.json");file.text=()=>new Promise(resolve=>{finish=resolve;});
    render(<LandUsePlanContextEditor {...props}/>);await ready();fireEvent.change(screen.getByLabelText("Restore a downloaded context copy"),{target:{files:[file]}});edit("Newer typing");
    await act(async()=>finish(JSON.stringify(old)));expect(bodyField()).toHaveValue("Newer typing");expect(readPlanContextRecovery(localStorage,scope)).toHaveLength(1);expect(posts).toEqual([]);
  });
  it("does not replace a restored copy when the initial context read arrives late",async()=>{
    let finish!:(response:Response)=>void;transport.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const old=makePlanContextDraft(scope,{...base,contextHash:"c".repeat(64)},{...draft,authorities:[{...draft.authorities[0],label:"Recovered before read"}]},id(10));retainPlanContextDraft(localStorage,old,null);
    render(<LandUsePlanContextEditor {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Open draft copy"}));
    await act(async()=>finish(Response.json(current)));expect(bodyField()).toHaveValue("Recovered before read");expect(saveButton()).toBeDisabled();expect(blocked()).toBe(true);
  });
  it("rechecks context after a workbench revision change while preserving an edited assessment",async()=>{
    const view=render(<LandUsePlanContextEditor {...props}/>);await ready();edit("Locally edited body");
    let finish!:(response:Response)=>void;transport.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    current={...current,contextHash:"c".repeat(64),contextState:{status:"retained",context:{...context,assessment:{...context.assessment,authorities:[{...context.assessment.authorities[0],label:"New saved body"}]}}}};
    view.rerender(<LandUsePlanContextEditor {...props} draftRevision={8}/>);expect(blocked()).toBe(true);expect(bodyField()).toBeDisabled();
    await act(async()=>finish(Response.json(current)));expect(bodyField()).toHaveValue("Locally edited body");expect(saveButton()).toBeDisabled();expect(screen.getByText("Review this older draft against the saved context")).toBeVisible();
    expect(props.onBlockChange.mock.calls.at(-1)?.[0]).toBe(`${scope.actorId}:${scope.workspaceId}:${scope.planId}:${base.versionId}:8`);
  });
  it("blocks freezing until a changed revision has a fresh context read even without edits",async()=>{
    const view=render(<LandUsePlanContextEditor {...props}/>);await ready();expect(blocked()).toBe(false);
    let finish!:(response:Response)=>void;transport.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    view.rerender(<LandUsePlanContextEditor {...props} draftRevision={8}/>);expect(blocked()).toBe(true);
    await act(async()=>finish(Response.json(current)));expect(blocked()).toBe(false);expect(posts).toEqual([]);
  });
  it("preserves unsaved fields during manual refresh and keeps permission changes read-only",async()=>{
    const view=render(<LandUsePlanContextEditor {...props}/>);await ready();edit("Unsaved local body");
    current={...current,canWrite:false,contextHash:"c".repeat(64)};
    fireEvent.click(screen.getByRole("button",{name:"Refresh saved context"}));await waitFor(()=>expect(props.onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(bodyField()).toBeDisabled());expect(bodyField()).toHaveValue("Unsaved local body");expect(blocked()).toBe(true);
    view.rerender(<LandUsePlanContextEditor {...props} canWrite={true}/>);expect(bodyField()).toBeDisabled();expect(posts).toEqual([]);
  });
  it("refuses a late restore file after the account changes",async()=>{
    const old=makePlanContextDraft(scope,base,draft,id(10));let finish!:(raw:string)=>void;
    const file=new File(["x"],"draft.json");file.text=()=>new Promise(resolve=>{finish=resolve;});
    const view=render(<LandUsePlanContextEditor {...props}/>);await ready();fireEvent.change(screen.getByLabelText("Restore a downloaded context copy"),{target:{files:[file]}});
    current={...current,actorId:id(40)};view.rerender(<LandUsePlanContextEditor {...props} actorId={id(40)}/>);await ready();
    await act(async()=>finish(JSON.stringify(old)));expect(readPlanContextRecovery(localStorage,scope)).toEqual([]);expect(readPlanContextRecovery(localStorage,{...scope,actorId:id(40)})).toEqual([]);
  });
  it("keeps current typing when a different recovered request is confirmed",async()=>{
    render(<LandUsePlanContextEditor {...props}/>);await ready();edit("Separate unsaved assessment");
    act(()=>{retainPlanContextCommand(localStorage,pending);window.dispatchEvent(new StorageEvent("storage"));});
    transport.mockImplementation(async(_url,init)=>{if(init?.method!=="POST")return Response.json(current);posts.push(String(init.body));return response(String(init.body),true);});
    fireEvent.click(screen.getByRole("button",{name:"Retry exact save request"}));await screen.findByText("The recovered save is confirmed. Your separate draft remains available for review.");
    expect(bodyField()).toHaveValue("Separate unsaved assessment");expect(blocked()).toBe(true);expect(readPlanContextRecovery(localStorage,scope).find(r=>!r.archived)?.value).toMatchObject({kind:"draft",draft:{authorities:[{label:"Separate unsaved assessment"}]}});
  });
  it("keeps every copy when a mismatched save reply arrives",async()=>{
    transport.mockImplementation(async(_url,init)=>{
      if(init?.method!=="POST")return Response.json(current);
      posts.push(String(init.body));const valid=await response(String(init.body)).json();return Response.json({...valid,commandId:id(99)},{status:201});
    });render(<LandUsePlanContextEditor {...props}/>);await ready();edit();fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("does not match");expect(props.onRefresh).not.toHaveBeenCalled();expect(blocked()).toBe(true);
    expect(readPlanContextRecovery(localStorage,scope).map(r=>r.value?.kind).sort()).toEqual(["draft","pending"]);
  });
  it("recovers current typing under a new key after another copy changes",async()=>{
    render(<LandUsePlanContextEditor {...props}/>);await ready();edit("First local edit");const first=readPlanContextRecovery(localStorage,scope)[0];
    localStorage.setItem(first.key,"Externally changed copy");edit("Newer local edit");expect(screen.getByRole("alert")).toHaveTextContent("copy changed");
    fireEvent.click(screen.getByRole("button",{name:"Keep text as a new browser draft"}));
    expect(localStorage.getItem(first.key)).toBe("Externally changed copy");expect(bodyField()).toHaveValue("Newer local edit");
    const copies=readPlanContextRecovery(localStorage,scope);expect(copies).toHaveLength(2);expect(copies.find(r=>r.key!==first.key)?.value).toMatchObject({draft:{authorities:[{label:"Newer local edit"}]},base});
    expect(posts).toEqual([]);expect(blocked()).toBe(true);
  });
  it("saves an uploaded study area and multiple responsible bodies through the mounted fields",async()=>{
    transport.mockImplementation(async(_url,init)=>{
      if(init?.method!=="POST")return Response.json(current);
      const command=planContextSaveSchema.parse(JSON.parse(String(init.body)));expect(command.place.mode).toBe("uploaded");
      if(command.place.mode!=="uploaded")throw new Error("Expected uploaded fixture");
      const place=placeOfRecordFromCapturedArea(command.place)!;expect(command.assessment.authorities).toHaveLength(2);
      expect(command.assessment.authorities[1]).toMatchObject({kind:"tribal_government",jurisdiction:null});
      posts.push(String(init.body));const saved={...context,assessment:command.assessment,place} as SavedPlanContext;
      current={...current,contextState:{status:"retained",context:saved},contextHash:"b".repeat(64)};
      return Response.json({replayed:false,commandId:command.commandId,versionId:command.versionId,context:saved,contextHash:current.contextHash},{status:201});
    });
    render(<LandUsePlanContextEditor {...props}/>);await ready();fireEvent.click(screen.getByLabelText("Keep the saved plan area unchanged"));
    const file=new File(["boundary"],"boundary.geojson");file.text=async()=>JSON.stringify({type:"Polygon",coordinates:[[[0,0],[2,0],[2,1],[0,0]]]});
    fireEvent.change(screen.getByLabelText("Or upload a study boundary"),{target:{files:[file]}});await waitFor(()=>expect(readPlanContextRecovery(localStorage,scope)[0].value?.draft.place.mode).toBe("uploaded"));
    fireEvent.change(screen.getByLabelText("Plan area label"),{target:{value:"Synthetic replacement area"}});fireEvent.click(screen.getByRole("button",{name:"Add responsible body"}));
    fireEvent.change(screen.getAllByLabelText("Body name")[1],{target:{value:"Synthetic sovereign body"}});fireEvent.change(screen.getAllByLabelText("Role in this plan")[1],{target:{value:"Consulting authority"}});
    fireEvent.change(screen.getAllByLabelText("Type of body")[1],{target:{value:"Tribal government"}});fireEvent.click(saveButton());
    await screen.findByText("Plan context saved and refreshed.");expect(posts).toHaveLength(1);expect(blocked()).toBe(false);
    expect(JSON.parse(posts[0]).place).toMatchObject({mode:"uploaded",label:"Synthetic replacement area"});expect(screen.getAllByLabelText("Jurisdiction is not assessed")[1]).toBeChecked();
  });
  it("bounds restored file size and restores pending bytes locally without sending",async()=>{
    render(<LandUsePlanContextEditor {...props}/>);await ready();
    const large=new File(["x"],"large.json");Object.defineProperty(large,"size",{value:12_000_001});large.text=vi.fn();
    fireEvent.change(screen.getByLabelText("Restore a downloaded context copy"),{target:{files:[large]}});expect(screen.getByRole("alert")).toHaveTextContent("size limit");expect(large.text).not.toHaveBeenCalled();
    const file=new File(["x"],"request.json");file.text=async()=>JSON.stringify(pending);
    fireEvent.change(screen.getByLabelText("Restore a downloaded context copy"),{target:{files:[file]}});await screen.findByText("The copy is restored. Nothing has been sent.");
    expect(posts).toEqual([]);expect(readPlanContextRecovery(localStorage,scope)[0].value).toEqual(pending);expect(saveButton()).toBeDisabled();
  });
  it("clears only an exact draft owned by the confirming instance",()=>{
    const owned=makePlanContextDraft(scope,base,draft,id(10)),other={...owned,instanceId:id(11)};
    const first=retainPlanContextDraft(localStorage,owned,null);retainPlanContextDraft(localStorage,other,null);
    expect(()=>clearOwnedPlanContextDraft(localStorage,owned,id(11))).toThrow("Another browser instance");
    localStorage.setItem(first.key,"newer");expect(()=>clearOwnedPlanContextDraft(localStorage,owned,id(10))).toThrow("copy changed");
    localStorage.setItem(first.key,first.raw);const remove=vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{});
    expect(()=>clearOwnedPlanContextDraft(localStorage,owned,id(10))).toThrow("could not be cleared");remove.mockRestore();
    clearOwnedPlanContextDraft(localStorage,owned,id(10));expect(readPlanContextRecovery(localStorage,scope).map(r=>r.value)).toEqual([other]);
  });
  it("downloads the actual draft bytes as a usable JSON artifact",async()=>{
    const blobs:Blob[]=[];vi.stubGlobal("URL",class extends URL { static createObjectURL=vi.fn((blob:Blob)=>{blobs.push(blob);return "blob:context-copy";}); static revokeObjectURL=vi.fn(); });
    const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
    render(<LandUsePlanContextEditor {...props}/>);await ready();edit();fireEvent.click(screen.getByRole("button",{name:"Download this draft"}));
    expect(click).toHaveBeenCalledTimes(1);expect(blobs).toHaveLength(1);
    const raw=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blobs[0]);});
    expect(JSON.parse(raw)).toMatchObject({...scope,base,draft:{authorities:[{label:"Revised planning body"}]}});
    expect(within(screen.getByRole("region",{name:"Plan context"})).getByRole("button",{name:"Save plan context"})).toBeEnabled();
  });
});
