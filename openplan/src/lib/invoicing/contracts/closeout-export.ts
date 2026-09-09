import type { ContractState } from "./schema";
import type { CloseoutPosition } from "./closeout-schema";
export type CloseoutPackage={formatVersion:1|2|3;state:ContractState;position:CloseoutPosition;request:{asOf:string}};
/** Stable financial identities support independent reconciliation; source versions are never summed together. */
export function accountingHandoffRows(pkg:CloseoutPackage):string[][]{
 const {state,position}=pkg,currency=state.baselines.filter(b=>b.state==="approved").at(-1)?.content.currency??"unassessed";
 const rows:string[][]=[["record_type","record_id","version","parent_id","external_id","direction","invoice_id","date","currency","amount","hours","task_id","staff_id","deliverable_id","state","evidence"]];
 for(const v of state.actuals){rows.push(["actual_version",v.id,String(v.version),v.entry_id,v.command.sourceKey,"",v.command.invoiceId??"",v.command.entryDate,currency,v.amount??"unassessed",v.hours??"unassessed","",v.command.staffId??"","",v.command.status,v.command.sourceReference]);for(const [index,a] of v.allocations.entries())rows.push(["actual_allocation",`${v.id}:${index}`,String(v.version),v.id,v.command.sourceKey,"",v.command.invoiceId??"",v.command.entryDate,currency,a.amount??"unassessed",a.hours??"unassessed",a.taskId,v.command.staffId??"",a.deliverableId??"",v.command.status,`Share ${a.share}/10000; category ${v.command.category}`]);}
 for(const s of state.billingSources)for(const l of s.lines)rows.push(["outgoing_billing_allocation",l.lineId,"",s.actual_version_id,s.entry_id,"outgoing",s.invoice_id,"",currency,l.amount,l.hours??"unassessed",l.taskId,state.actuals.find(a=>a.id===s.actual_version_id)?.command.staffId??"",l.deliverableId??"","retained","Presentation of an existing incurred source; no second cost"]);
 for(const i of state.receivedInvoices??[])rows.push(["received_invoice_version",i.id,String(i.version),i.invoice_id,i.content.number,"received",i.invoice_id,i.content.date,i.content.currency,i.content.total,"","","","",i.state,i.review_note]);
 for(const e of state.closeout?.settlements??[])rows.push([`financial_${e.content.kind}`,e.id,String(e.version),e.content.eventId,e.content.sourceKey,e.content.direction,e.content.invoiceId,e.content.date,e.content.currency,e.content.amount,"","","","",e.content.state,`${e.content.sourceReference}; legacy source ${e.content.legacyActualId??"none"}; ${e.content.correctionEvidence}`]);
 for(const i of position.invoices)for(const metric of ["gross","payments","credits","refunds","adjustments","retention","disputed","open","currentlyDue"] as const)rows.push([`invoice_total_${metric}`,i.id,i.version,"",i.number,i.direction,i.id,pkg.request.asOf,i.currency,i[metric]??"unassessed","","","","","reconciled",i.warnings.join("; ")]);
 rows.push(["contract_total_incurred",state.engagement.id,"","","","","",pkg.request.asOf,currency,position.incurred,"","","","","reconciled","Sum current approved physical cost sources once; payments, credits and commitments are separate"]);
 if(pkg.formatVersion>=2){
  rows[0].push("source_key","source_version_id","source_file_id","source_sha256","cost_treatment","allocation_share","source_allocation_amount","source_allocation_hours","reviewed_row_index");
  for(const row of rows.slice(1))while(row.length<rows[0].length)row.push("");
  const add=(base:string[],detail:string[])=>{rows.push([...base,...detail]);};
  for(const invoice of state.receivedInvoices??[]){
   const checksum=pkg.formatVersion>=3?invoice.source_receipt?.checksum??"unassessed":"";
   for(const [index,line] of invoice.content.lines.entries())add(["received_invoice_line",`${invoice.id}:line:${index}`,String(invoice.version),invoice.id,invoice.content.number,"received",invoice.invoice_id,invoice.content.date,invoice.content.currency,line.amount,"","","","",invoice.state,`${line.description}; ${line.basis}`],["","",invoice.content.fileId,checksum,line.treatment,"","","",""]);
   for(const [index,match] of (invoice.matches??[]).entries()){
    const identity=`${invoice.id}:match:${index}`;
    add(["received_cost_match",identity,String(invoice.version),match.entryId,invoice.content.number,"received",invoice.invoice_id,invoice.content.date,invoice.content.currency,match.amount,"","",match.staffId??"","",invoice.state,"Matched to an existing source; no additional incurred cost"],[match.sourceKey??"",match.versionId,invoice.content.fileId,checksum,match.category??"","","","",""]);
    for(const [allocationIndex,allocation] of (match.allocations??[]).entries())add(["received_match_source_allocation",`${identity}:${allocationIndex}`,String(invoice.version),identity,invoice.content.number,"received",invoice.invoice_id,invoice.content.date,invoice.content.currency,"","",allocation.taskId,match.staffId??"",allocation.deliverableId??"",invoice.state,"Retained full source allocation, not an allocation of the matched invoice amount; do not add to costs or invoice totals"],[match.sourceKey??"",match.versionId,invoice.content.fileId,checksum,match.category??"",String(allocation.share),allocation.amount??"unassessed",allocation.hours??"unassessed",""]);
   }
  }
  if(pkg.formatVersion>=3)for(const invoice of state.receivedInvoices??[]){
   const file=invoice.source_receipt;
   add(["received_file_receipt",`${invoice.id}:file`,String(invoice.version),invoice.id,invoice.content.number,"received",invoice.invoice_id,invoice.content.date,invoice.content.currency,"","","","","",file?"retained":"unassessed",file?`${file.filename}; ${file.contentType}; ${file.bytes} bytes`:"Original file receipt unavailable"],["","",file?.id??invoice.content.fileId,file?.checksum??"unassessed","","","","",""]);
  }
  for(const imported of state.accountingImports??[])for(const [index,row] of imported.rows.entries())add(["accounting_import_row",`${imported.id}:${index}`,"",imported.id,row.externalId,"","",imported.created_at,row.currency,row.amount,row.hours??"unassessed","","","","external_authority",`Original file: ${imported.filename}; comparison record, not a new cost`],[row.sourceKey,"",imported.id,imported.source_hash,"","","","",String(index)]);
  for(const review of state.accountingReviews??[]){
   const imported=state.accountingImports?.find(i=>i.id===review.import_id),row=imported?.rows[review.row_index],actual=state.actuals.find(a=>a.id===review.actual_version_id);
   add(["accounting_review_version",review.id,String(review.version),review.import_id,row?.externalId??"","","",review.created_at,row?.currency??"unassessed","","","",actual?.command.staffId??"","",review.state,review.evidence],[row?.sourceKey??"",review.actual_version_id??"",review.import_id,imported?.source_hash??"",actual?.command.category??"","","","",String(review.row_index)]);
  }
  rows.push(["handoff_format",state.engagement.id,String(pkg.formatVersion),state.engagement.project_id,"","","",pkg.request.asOf,currency,"","","","","","retained","Only contract_total_incurred is the reconciled incurred total. Historical versions, invoice presentations, matches and external comparisons must not be added together.","","","","","","","","",""]);
 }
 return rows;
}
export function accountingHandoffCsv(pkg:CloseoutPackage){return accountingHandoffRows(pkg).map(row=>row.map(v=>`"${(/^[=+@\t\r]/.test(v)||(/^\-/.test(v)&&!/^\-?\d+(\.\d+)?$/.test(v))?"'":"")+v.replaceAll('"','""')}"`).join(",")).join("\r\n")+"\r\n";}
