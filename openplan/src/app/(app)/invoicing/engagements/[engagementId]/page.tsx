import { ContractManagement } from "@/components/invoicing/contracts/contract-management";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import type { ContractState } from "@/lib/invoicing/contracts/schema";
import { loadWorkspaceCalendar } from "@/lib/time/workspace-calendar";
export const metadata={title:"Contract management"};
export const dynamic="force-dynamic";
export default async function ContractPage({params}:{params:Promise<{engagementId:string}>}) {
 const access=await contractAccess((await params).engagementId);
 if(access.response)return <div className="p-8"><h1 className="text-2xl">Contract management unavailable</h1><p className="mt-3">Sign in with access to this contract, and confirm the contract is linked to a project.</p></div>;
 const state=access.state as ContractState;
 // Form dates default to today on the workspace calendar. The read uses the service client because a
 // consultant with contract access may not be a workspace member; it is scoped to the workspace the
 // authorized contract read returned and reads only the zone columns. A failed read answers UTC.
 const calendar=await loadWorkspaceCalendar(access.service,state.engagement.workspace_id);
 return <ContractManagement initial={state} timeZone={calendar.timeZone}/>;
}
