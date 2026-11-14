import { ContractManagement } from "@/components/invoicing/contracts/contract-management";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import type { ContractState } from "@/lib/invoicing/contracts/schema";
import { notFound } from "next/navigation";
import { loadWorkspaceCalendar } from "@/lib/time/workspace-calendar";
import { isUuid } from "@/lib/uuid";
export const metadata={title:"Contract management"};
export const dynamic="force-dynamic";
export default async function ContractPage({params}:{params:Promise<{engagementId:string}>}) {
 const {engagementId}=await params;
 if(!isUuid(engagementId))notFound();
 const access=await contractAccess(engagementId);
 // The contract read refuses a missing contract and one the reader may not manage with the same 403
 // ("Contract access denied"), so both answer the same real 404 (KI-2026-11-14-280). Any other refusal,
 // such as a read that did not complete, keeps the notice below.
 if(access.response?.status===403)notFound();
 if(access.response)return <div className="p-8"><h1 className="text-2xl">Contract management unavailable</h1><p className="mt-3">Sign in with access to this contract, and confirm the contract is linked to a project.</p></div>;
 const state=access.state as ContractState;
 // Form dates default to today on the workspace calendar. The read uses the service client because a
 // consultant with contract access may not be a workspace member; it is scoped to the workspace the
 // authorized contract read returned and reads only the zone columns. A failed read answers UTC.
 const calendar=await loadWorkspaceCalendar(access.service,state.engagement.workspace_id);
 return <ContractManagement initial={state} timeZone={calendar.timeZone}/>;
}
