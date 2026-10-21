/** AUTHORED, UNEXECUTED. DOM fixtures cannot establish geometry, PDF, layout, console or real navigation. */
import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { SafetyCandidateComparisonEditor } from "@/components/safety/safety-candidate-comparison-editor";
import { comparisonFixture,comparisonId,comparisonRevision,rehashComparison } from "./fixtures/safety/comparison";
const fetchMock=vi.fn();
function context(){const comparison=comparisonFixture();return {actorId:comparisonId(1),report:{id:comparison.report_id,project_id:comparison.project_id,title:"Synthetic report",updated_at:comparisonRevision,metadata_json:{safetyComparisonV2:{version:"openplan.safety-comparison.v2",revisionId:comparison.id,hash:comparison.content_hash}}},project:{id:comparison.project_id,updated_at:comparisonRevision,estimated_cost_amount:"99999999999999.91",estimated_cost_currency:"USD",estimated_cost_basis_year:null,estimated_cost_source_document_id:null},comparison,selectedAcquisition:null,acquisitions:[{id:comparisonId(5),source_label:"Synthetic retained source",evidence_revision:"1",years_requested:[2020],min_lon:0,min_lat:0,max_lon:1,max_lat:1}],nextCursor:null,artifacts:[],artifactNextCursor:null,canWrite:true,historical:false};}
const response=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>body});
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();vi.stubGlobal("fetch",fetchMock);fetchMock.mockImplementation(async(_url:string,init?:RequestInit)=>init?.method?response({error:"Outcome unknown",outcome:"outcome_unknown"},500):response(context()));});
describe("Safety input review editor",()=>{
 it("refreshes analysis scope on acquisition change while preserving a nonrectangular influence polygon", async () => {
   const source = context();
   source.comparison.payload.inputs.influenceArea = { type: "Polygon", coordinates: [[[0.1,0.1],[0.7,0.1],[0.2,0.7],[0.1,0.1]]] };
   rehashComparison(source.comparison);
   source.report.metadata_json.safetyComparisonV2.hash = source.comparison.content_hash;
   source.acquisitions.push({ ...source.acquisitions[0], id: comparisonId(25), source_label: "New synthetic source", min_lon: 0.05, min_lat: 0.05, max_lon: 0.8, max_lat: 0.8, years_requested: [2021] });
   fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method ? response({ error: "Outcome unknown", outcome: "outcome_unknown" }, 500) : response(source));
   render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)} />);
   await screen.findByDisplayValue("Synthetic input review");
   fireEvent.change(screen.getByLabelText("Retained acquisition"), { target: { value: comparisonId(25) } });
   expect(screen.getByLabelText("Requested observation years, separated by commas")).toHaveValue("");
   fireEvent.change(screen.getByLabelText("Requested observation years, separated by commas"), { target: { value: "2021" } });
   fireEvent.click(screen.getByRole("button", { name: "Save immutable evidence review" }));
   await waitFor(() => expect(fetchMock.mock.calls.some(([,init]) => init?.method === "PATCH")).toBe(true));
   const command = JSON.parse(fetchMock.mock.calls.find(([,init]) => init?.method === "PATCH")![1].body).safetyComparison;
   expect(command.inputs.influenceArea).toEqual(source.comparison.payload.inputs.influenceArea);
   expect(command.inputs.analysisGeometry.coordinates).toEqual([[[0.05,0.05],[0.8,0.05],[0.8,0.8],[0.05,0.8],[0.05,0.05]]]);
   expect(command.inputs.acquisitionId).toBe(comparisonId(25));
   expect(command.expectedAcquisitionRevision).toBe("1");
 });
 it("refuses an acquisition that cannot cover the retained influence polygon before sending", async () => {
   const source = context();
   source.acquisitions.push({ ...source.acquisitions[0], id: comparisonId(25), source_label: "Smaller synthetic source", max_lon: 0.5 });
   fetchMock.mockResolvedValue(response(source));
   render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)} />);
   await screen.findByDisplayValue("Synthetic input review");
   fireEvent.change(screen.getByLabelText("Retained acquisition"), { target: { value: comparisonId(25) } });
   fireEvent.change(screen.getByLabelText("Requested observation years, separated by commas"), { target: { value: "2020" } });
   fireEvent.click(screen.getByRole("button", { name: "Save immutable evidence review" }));
   expect(await screen.findByRole("alert")).toHaveTextContent("does not cover the retained influence polygon");
   expect(fetchMock.mock.calls.some(([,init]) => init?.method === "PATCH")).toBe(false);
 });
 it("keeps saved analysis and influence vertices when acquisition and bounds stay unchanged", async () => {
   const source = context();
   source.comparison.payload.inputs.analysisGeometry = { type: "Polygon", coordinates: [[[0.05,0.05],[0.95,0.05],[0.2,0.95],[0.05,0.05]]] };
   source.comparison.payload.inputs.influenceArea = { type: "Polygon", coordinates: [[[0.1,0.1],[0.7,0.1],[0.2,0.7],[0.1,0.1]]] };
   rehashComparison(source.comparison);
   fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method ? response({ error: "Outcome unknown", outcome: "outcome_unknown" }, 500) : response(source));
   render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)} />);
   await screen.findByDisplayValue("Synthetic input review");
   fireEvent.click(screen.getByRole("button", { name: "Save immutable evidence review" }));
   await waitFor(() => expect(fetchMock.mock.calls.some(([,init]) => init?.method === "PATCH")).toBe(true));
   const inputs = JSON.parse(fetchMock.mock.calls.find(([,init]) => init?.method === "PATCH")![1].body).safetyComparison.inputs;
   expect(inputs.influenceArea).toEqual(source.comparison.payload.inputs.influenceArea);
   expect(inputs.analysisGeometry).toEqual(source.comparison.payload.inputs.analysisGeometry);
 });
 it("reopens saved values, missing price year, exact estimate and revision-specific CSV",async()=>{render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)}/>);await screen.findByDisplayValue("Synthetic input review");expect(screen.getByText(/99,999,999,999,999.91/)).toBeTruthy();expect(screen.getByText(/Price year: Unknown/)).toBeTruthy();expect(screen.getByRole("link",{name:"Download exact revision CSV"}).getAttribute("href")).toContain(`revisionId=${comparisonId(6)}`);expect(screen.getByText(/Missing source: the exact selected fiscal-year SS4A NOFO/)).toBeTruthy();});
 it("locks editing and replays exactly the retained command after an unknown outcome",async()=>{render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)}/>);await screen.findByDisplayValue("Synthetic input review");fireEvent.click(screen.getByRole("button",{name:"Save immutable evidence review"}));await screen.findByRole("button",{name:"Retry retained request"});const first=fetchMock.mock.calls.find(([,init])=>init?.method==="PATCH")![1].body;expect(screen.getByLabelText("Study title")).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"Retry retained request"}));await waitFor(()=>expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="PATCH")).toHaveLength(2));const writes=fetchMock.mock.calls.filter(([,init])=>init?.method==="PATCH");expect(writes[1][1].body).toBe(first);expect(sessionStorage.length).toBe(1);});
 it("generates the saved revision while unsaved text stays outside the generation command",async()=>{render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)}/>);await screen.findByDisplayValue("Synthetic input review");fireEvent.change(screen.getByLabelText("Study title"),{target:{value:"Unsaved display edit"}});fireEvent.click(screen.getByRole("button",{name:"Generate frozen HTML"}));await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(true));const body=JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==="POST")![1].body);expect(body.safetyComparison.revisionId).toBe(comparisonId(6));expect(body.safetyComparison).not.toHaveProperty("inputs");expect(body.safetyComparison).not.toHaveProperty("generatedAt");});
 it("keeps viewer reads while disabling save and generation",async()=>{fetchMock.mockResolvedValue(response({...context(),canWrite:false}));render(<SafetyCandidateComparisonEditor reportId={comparisonId(4)}/>);await screen.findByDisplayValue("Synthetic input review");expect(screen.getByRole("button",{name:"Save immutable evidence review"})).toBeDisabled();expect(screen.getByRole("button",{name:"Generate frozen PDF"})).toBeDisabled();});
});
