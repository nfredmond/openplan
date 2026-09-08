import Link from "next/link";
import { readAssignmentInvoicePosition } from "@/lib/invoicing/contracts/invoice-position-server";
export async function InvoiceBalance({engagementId,invoiceId}:{engagementId:string;invoiceId:string}){
 const position=(await readAssignmentInvoicePosition(engagementId))?.find(i=>i.id===invoiceId&&i.direction==="outgoing");
 return <div className="mt-2 space-y-1 text-sm">{position?<><p>Documented open balance {position.open} {position.currency}; currently due {position.currentlyDue}; retained {position.retention}; disputed {position.disputed}.</p>{position.warnings.map(w=><p key={w}>{w}</p>)}</>:<p>Documented settlement balance is unassessed or requires designated contract access.</p>}<Link className="underline" href={`/invoicing/engagements/${engagementId}?tab=settlement`}>Review invoice settlement</Link></div>;
}
