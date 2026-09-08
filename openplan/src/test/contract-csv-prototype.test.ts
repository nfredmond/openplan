import { describe,expect,it } from "vitest";
import { parse } from "csv-parse/sync";
describe("retained CSV headers",()=>{
 it("keeps a duplicated prototype-named header as data without replacing the record prototype",()=>{
  const [row]=parse('__proto__,__proto__,externalId\na,b,SYNTHETIC-CHECK\n',{columns:true,group_columns_by_name:true}) as Record<string,unknown>[];
  expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  expect(Object.hasOwn(row,"__proto__")).toBe(true);
  expect(row.__proto__).toEqual(["a","b"]);
  expect(row.externalId).toBe("SYNTHETIC-CHECK");
 });
});
