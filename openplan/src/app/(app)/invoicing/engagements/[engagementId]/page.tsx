import { ContractManagement } from "@/components/invoicing/contracts/contract-management";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import type { ContractState } from "@/lib/invoicing/contracts/schema";
export const metadata={title:"Contract management"};
export const dynamic="force-dynamic";
export default async function ContractPage({params}:{params:Promise<{engagementId:string}>}) {
 const access=await contractAccess((await params).engagementId);
 if(access.response)return <main className="p-8"><h1 className="text-2xl">Contract management unavailable</h1><p className="mt-3">Sign in with access to this contract, and confirm the contract is linked to a project.</p></main>;
 return <ContractManagement initial={access.state as ContractState}/>;
}
