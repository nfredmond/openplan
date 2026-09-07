import {writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {extractWorkProgramSource} from "../../src/lib/programs/work-program/source-extraction";
const root="/home/nathaniel/.local/state/openplan/housekeeping-2026-09-06/owp-sources";
for(const name of ["edctc-2025-26-amendment-2","edctc-2026-27-final"]) {
  const text=execFileSync("pdftotext",["-layout",`${root}/${name}.pdf`,"-"],{encoding:"utf8"});
  const pages=text.split("\f");if(!pages.at(-1)?.trim())pages.pop();
  const extracted=extractWorkProgramSource(pages.map((text,index)=>({page:index+1,text})));
  writeFileSync(`/home/nathaniel/.local/state/openplan/owp-preparation-db-2026-09-06/${name}-extraction.json`,JSON.stringify(extracted,null,2));
  console.log(name,extracted.parser,extracted.pageCount,extracted.elements.map(e=>({code:e.code,pages:[e.pageFrom,e.pageTo],tasks:!!e.currentActivities,products:!!e.products,revenue:e.revenueTotal,cost:e.costTotal})));
}
