import { createClient } from "@/lib/supabase/server";
import { readAssignmentInvoicePosition } from "@/lib/invoicing/contracts/invoice-position-server";
import { cents,decimalText } from "@/lib/programs/work-program/reporting";
/** Read every issued invoice before presenting currency-separated documented balances. */
export async function ContractCashPosition({workspaceId}:{workspaceId:string}){
 const client=await createClient(),rows:{id:string;engagement_id:string|null}[]=[];let failed=false;
 for(let offset=0;;offset+=200){const page=await client.from("client_invoices").select("id,engagement_id").eq("workspace_id",workspaceId).in("status",["sent","paid"]).order("id").range(offset,offset+199);if(page.error){failed=true;break;}rows.push(...page.data);if(page.data.length<200)break;}
 const totals=new Map<string,bigint>();let missing=0,warnings=0;
 for(const row of rows){const p=row.engagement_id?(await readAssignmentInvoicePosition(row.engagement_id))?.find(i=>i.id===row.id&&i.direction==="outgoing"):null;if(!p){missing++;continue;}totals.set(p.currency,(totals.get(p.currency)??BigInt(0))+cents(p.open));warnings+=p.warnings.length;}
 return <section className="space-y-2"><h2 className="text-sm font-semibold">Documented client invoice balances</h2>{failed?<p>The complete invoice list could not be read. No total is asserted.</p>:!rows.length?<p>No issued client invoices.</p>:<>{[...totals].map(([currency,amount])=><p key={currency} className="text-2xl font-semibold">{decimalText(amount)} {currency}{missing?" known balance":" open balance"}</p>)}<p>Includes retained and disputed amounts. Refund obligations can produce a negative balance.</p>{missing>0&&<p>{missing} invoices have unassessed settlement or require designated contract access. A complete balance is unavailable.</p>}{warnings>0&&<p>{warnings} unresolved financial comparisons need review in invoice settlement.</p>}</>}</section>;
}
