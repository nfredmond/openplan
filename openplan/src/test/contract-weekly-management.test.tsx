import {beforeEach,it,expect,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {deliveryFixture} from "./fixtures/contract-delivery";
const mocks=vi.hoisted(()=>({range:vi.fn(),select:vi.fn(),eq:vi.fn(),order:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"synthetic-pm"}}})},from:(table:string)=>table==="projects"?{select:(columns:string)=>{expect(columns).toBe("id,name,workspace_id");return {eq:()=>({maybeSingle:async()=>({data:{id:"project",name:"Synthetic project",workspace_id:"workspace"},error:null})})};}}:{select:mocks.select}}),createServiceRoleClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/notifications/cron-heartbeat",()=>({classifyCronFreshness:()=>"missing",readCronHeartbeatAt:async()=>null,CRON_JOB_SWEEP_DEADLINES:"sweep"}));
vi.mock("@/lib/notifications/email",()=>({isEmailTransportConfigured:()=>false}));
import WeeklyManagement from "@/app/(app)/projects/[projectId]/management/page";
beforeEach(()=>{vi.clearAllMocks();mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({eq:mocks.eq,order:mocks.order});mocks.order.mockReturnValue({range:mocks.range});});
it("reads every low-cap page with project scope and withholds contracts without PM access",async()=>{
 const rows=[{id:"first"},{id:"private"},{id:"last"}];mocks.range.mockImplementation(async(start:number)=>({data:rows.slice(start,start+1),error:null}));
 mocks.rpc.mockImplementation(async(_name:string,args:{p_engagement_id:string})=>{const f=deliveryFixture();f.state.engagement.title=args.p_engagement_id==="private"?"PRIVATE-CONTRACT":"Synthetic "+args.p_engagement_id;f.state.engagement.id=args.p_engagement_id;f.state.role=args.p_engagement_id==="private"?"member":"pm";return {data:f.state,error:null};});
 const html=renderToStaticMarkup(await WeeklyManagement({params:Promise.resolve({projectId:"project"})}));expect(html).toContain("Synthetic first");expect(html).toContain("Synthetic last");expect(html).not.toContain("PRIVATE-CONTRACT");expect(html).toContain("1 contracts require separate management access");expect(mocks.range.mock.calls).toEqual([[0,199],[1,200],[2,201],[3,202]]);expect(mocks.select).toHaveBeenCalledWith("id");expect(mocks.eq).toHaveBeenCalledWith("project_id","project");expect(mocks.eq).toHaveBeenCalledWith("workspace_id","workspace");expect(mocks.order).toHaveBeenCalledWith("id");expect(mocks.rpc).toHaveBeenCalledWith("read_contract_management",{p_engagement_id:"last",p_actor_id:"synthetic-pm"});
});
it("discloses a failed later read without presenting the first contract as complete",async()=>{
 mocks.range.mockImplementation(async(start:number)=>start===0?{data:[{id:"first"}],error:null}:{data:null,error:{message:"Synthetic later failure"}});
 const html=renderToStaticMarkup(await WeeklyManagement({params:Promise.resolve({projectId:"project"})}));expect(html).toContain("The contract register could not be fully read");expect(mocks.rpc).not.toHaveBeenCalled();expect(html).not.toContain("No contracts with designated management access");
});
