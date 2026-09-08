import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ActualForm, emptyActual } from "@/components/invoicing/contracts/actual-form";
import { contractActualSchema, type ActualVersion, type ContractState } from "@/lib/invoicing/contracts/schema";

it("submits a valid member correction after optional source identifiers were redacted", async () => {
 const command={...emptyActual(randomUUID()),requestId:randomUUID(),entryId:randomUUID(),sourceKey:"synthetic-member",sourceReference:"Synthetic timesheet",description:"Synthetic draft time",hours:"0.50"};
 const correcting:ActualVersion={id:randomUUID(),entry_id:command.entryId,version:1,command,amount:null,hours:"0.50",allocations:[],time_entry_id:randomUUID(),spend_entry_id:null,created_at:"2026-09-08T00:00:00Z"};
 Reflect.deleteProperty(correcting,"spend_entry_id");
 const state:ContractState={role:"member",engagement:{id:randomUUID(),workspace_id:randomUUID(),project_id:randomUUID(),title:"Synthetic contract",parent_engagement_id:null,engagement_kind:"contract"},baselines:[],actuals:[correcting],estimates:[],rates:[],staff:[{id:command.staffId!,name:"Synthetic member",active:true,user_id:randomUUID()}],deliverables:[],documents:[],invoices:[],billingSources:[],unmappedTime:[],unmappedSpend:[],snapshots:[]};
 const send=vi.fn().mockResolvedValue(true);
 render(<ActualForm state={state} correcting={correcting} send={send} busy={false} onSaved={()=>undefined}/>);
 fireEvent.change(screen.getByLabelText("Hours, empty if unknown"),{target:{value:"0.60"}});
 fireEvent.change(screen.getByLabelText("Correction reason"),{target:{value:"Synthetic typo correction"}});
 fireEvent.click(screen.getByRole("button",{name:"Save correction"}));
 await waitFor(()=>expect(send).toHaveBeenCalledOnce());
 expect(contractActualSchema.safeParse(send.mock.calls[0][0]).success).toBe(true);
 expect(send.mock.calls[0][0]).toMatchObject({hours:"0.60",expectedVersion:1,spendEntryId:null,entryId:command.entryId});
 expect(screen.queryByLabelText("Cost valuation")).toBeNull();
});
