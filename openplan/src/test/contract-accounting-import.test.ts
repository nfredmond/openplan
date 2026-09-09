import { describe, expect, it } from "vitest";
import { parseAccountingImport } from "@/lib/invoicing/contracts/import";
import { contractCommandSchema, type ContractCommand } from "@/lib/invoicing/contracts/schema";
const command:Extract<ContractCommand,{kind:"accounting_import"}>={kind:"accounting_import",requestId:"10000000-0000-4000-8000-000000000001",filename:"synthetic.csv",csv:'Posting,Source,Cost,Hours,Currency\nPOST-1,"source,one",25.01,,USD',mapping:{externalId:"Posting",sourceKey:"Source",amount:"Cost",hours:"Hours",currency:"Currency"}};
describe("accounting CSV comparison",()=>{
 it("derives exact rows from quoted CSV and preserves missing hours",()=>{
  expect(parseAccountingImport(command).rows).toEqual([{externalId:"POST-1",sourceKey:"source,one",amount:"25.01",hours:null,currency:"USD"}]);
  expect(parseAccountingImport(command).csv).toBe(command.csv);
  expect(contractCommandSchema.safeParse({...command,rows:[{amount:"99.00"}]}).success).toBe(false);
 });
 it("rejects ambiguous identity, unmapped columns and rounded monetary input",()=>{
  expect(()=>parseAccountingImport({...command,csv:command.csv+'\nPOST-1,another,20.00,,USD'})).toThrow("Repeated external identifier");
  expect(()=>parseAccountingImport({...command,mapping:{...command.mapping,amount:"Missing"}})).toThrow("exact amounts");
  expect(()=>parseAccountingImport({...command,csv:command.csv.replace('25.01','25.015')})).toThrow("exact amounts");
 });
});
