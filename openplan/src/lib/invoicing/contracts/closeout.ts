import { cents, decimalText } from "@/lib/programs/work-program/reporting";
import { currentActuals, reconcileContract } from "./reconciliation";
import type { ContractState } from "./schema";
import type { CloseoutCommand,CloseoutPosition,InvoicePosition,SettlementVersion } from "./closeout-schema";
export function currentSettlementEvents(versions:SettlementVersion[],asOf="9999-12-31"){
 const latest=new Map<string,SettlementVersion>();for(const v of versions)if(!latest.has(v.content.eventId)||latest.get(v.content.eventId)!.version<v.version)latest.set(v.content.eventId,v);
 return [...latest.values()].filter(v=>v.content.state==="recorded"&&v.content.date<=asOf);
}
/** Invoice obligations and cash events stay separate from incurred cost and gross contract fee. */
export function settlementPosition(state:ContractState,asOf="9999-12-31"):InvoicePosition[]{
 const events=currentSettlementEvents(state.closeout?.settlements??[],asOf),actuals=currentActuals(state.actuals,asOf).filter(a=>a.command.status==="approved");
 const received=new Map<string,NonNullable<ContractState["receivedInvoices"]>[number]>();for(const i of state.receivedInvoices??[])if(!received.has(i.invoice_id)||received.get(i.invoice_id)!.version<i.version)received.set(i.invoice_id,i);
 const invoices=[...state.invoices.filter(i=>["sent","paid"].includes(i.status)&&i.invoice_date&&i.invoice_date<=asOf).map(i=>({id:i.id,direction:"outgoing" as const,number:i.invoice_number,currency:i.currency_code,version:i.updated_at,gross:i.subtotal_amount,initialRetention:i.retention_amount})),...[...received.values()].filter(i=>i.state==="approved"&&i.content.date<=asOf).map(i=>({id:i.invoice_id,direction:"received" as const,number:i.content.number,currency:i.content.currency,version:String(i.version),gross:i.content.total,initialRetention:"0.00"}))];
 return invoices.map(invoice=>{
  let payments=BigInt(0),credits=BigInt(0),refunds=BigInt(0),adjustments=BigInt(0),retention=cents(invoice.initialRetention),disputed=BigInt(0);const warnings:string[]=[],seen=new Set<string>();
  const legacy=actuals.filter(a=>a.command.invoiceId===invoice.id&&["payment","credit"].includes(a.command.category));
  for(const a of legacy){if(a.amount===null){warnings.push("Legacy settlement source has no amount.");continue;}seen.add(a.entry_id);if(a.command.category==="payment")payments+=cents(a.amount);else credits+=cents(a.amount);}
  for(const event of events.filter(e=>e.content.invoiceId===invoice.id&&e.content.direction===invoice.direction)){
   const e=event.content;if(e.currency!==invoice.currency)throw new Error("Settlement currency differs from its invoice.");
   if(e.invoiceVersion!==invoice.version)warnings.push("Invoice changed after a retained settlement event; reconcile its version.");
   if(e.legacyActualId){const source=legacy.find(a=>a.entry_id===e.legacyActualId);if(!source||source.command.category!==e.kind||source.amount===null||cents(source.amount)!==cents(e.amount))warnings.push("Linked legacy payment or credit changed or is missing.");else if(seen.has(e.legacyActualId)){seen.delete(e.legacyActualId);}else throw new Error("A legacy settlement source was linked twice.");continue;}
   const amount=cents(e.amount);
   if(e.kind==="payment")payments+=amount;else if(e.kind==="credit")credits+=amount;else if(e.kind==="refund")refunds+=amount;else if(e.kind==="adjustment_debit")adjustments+=amount;else if(e.kind==="adjustment_credit")adjustments-=amount;else if(e.kind==="retention_hold")retention+=amount;else if(e.kind==="retention_release")retention-=amount;else if(e.kind==="dispute_open")disputed+=amount;else disputed-=amount;
  }
  if(retention<BigInt(0)||disputed<BigInt(0)||refunds>payments)warnings.push("A release or refund exceeds the documented amount held or paid.");
  const open=cents(invoice.gross)+adjustments-credits-payments+refunds;
  if(retention+disputed>(open>BigInt(0)?open:BigInt(0)))warnings.push("Retention and disputed amounts exceed the remaining invoice balance; reconcile overlap or release.");
  return {...invoice,payments:decimalText(payments),credits:decimalText(credits),refunds:decimalText(refunds),adjustments:decimalText(adjustments),retention:decimalText(retention),disputed:decimalText(disputed),open:decimalText(open),currentlyDue:decimalText(open-retention-disputed),warnings};
 });
}
export function closeoutPosition(state:ContractState,command:CloseoutCommand):CloseoutPosition{
 const reconciled=reconcileContract(state,{asOf:command.asOf}),invoices=settlementPosition(state,command.asOf),warnings:string[]=[],latest=new Map<string,NonNullable<ContractState["closeout"]>["deliverableEvents"][number]>();
 for(const event of state.closeout?.deliverableEvents??[])if(!latest.has(event.deliverable_id)||latest.get(event.deliverable_id)!.version<event.version)latest.set(event.deliverable_id,event);
 const tasks=reconciled.baseline?.content.tasks??[],workAccepted=tasks.length>0&&tasks.every(t=>t.deliverableId&&latest.get(t.deliverableId)?.state==="accepted"&&latest.get(t.deliverableId)!.date<=command.asOf);
 const currentReceived=new Map<string,string>();for(const i of state.receivedInvoices??[])currentReceived.set(i.invoice_id,i.state);
 if(!workAccepted)warnings.push("Some approved tasks lack a separately authorized accepted deliverable.");
 if(!command.coverageComplete||reconciled.unresolved.length||state.unmappedTime.length||state.unmappedSpend.length||state.unmappedSpendCount)warnings.push("Financial source coverage is incomplete or unresolved.");
 if([...currentReceived.values()].some(s=>s!=="approved")||state.invoices.some(i=>i.status==="draft"))warnings.push("Unresolved or draft invoices remain.");
 if(invoices.some(i=>i.open!=="0.00"||i.retention!=="0.00"||i.disputed!=="0.00"||i.warnings.length))warnings.push("Invoice balances, retention, disputes or version reconciliation remain open.");
 if(reconciled.total.commitments!=="0.00")warnings.push("Recorded commitments remain open.");
 const financialSettled=!warnings.some(w=>!w.startsWith("Some approved tasks"));
 if(command.workAccepted&&!workAccepted)throw new Error("Work acceptance cannot be claimed until each approved task has an authorized accepted deliverable.");
 if(command.financialSettled&&!financialSettled)throw new Error("Financial settlement cannot be claimed with unresolved source coverage, balances or commitments.");
 const authorizedCost=reconciled.baseline?.content.cost??null;
 return {invoices,workAccepted,financialSettled,incurred:reconciled.total.incurred,authorizedCost,underspend:authorizedCost===null?null:decimalText(cents(authorizedCost)-cents(reconciled.total.incurred)),commitments:reconciled.total.commitments,warnings,openObligations:command.obligations.filter(o=>o.status==="open").length};
}
