import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as XLSX from "xlsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/test/fixtures/portfolio-import");
mkdirSync(root, { recursive: true });

const summary = XLSX.utils.aoa_to_sheet([
  ["Workbook notes"],
  ["Do not import this explanatory row"],
  ["ID", "Project", "Cost", "Location", "Calculated cost", "Repeated", "Repeated"],
  ["A-1", "Calle Peatonal ñ", 12.5, "Distrito Norte", null, "left", "right"],
  ["DUP-7", "Shared name", "3.25", "Sector 2", null, "left", "right"],
  ["", "", "", "", "", "", ""],
]);
// The cached value deliberately differs from the arithmetic result. A parser
// that recalculates C4*2 would return 25 instead of the required cached 999.
summary.E4 = { t: "n", f: "C4*2", v: 999 };
summary.E5 = { t: "e", f: "C5/0", v: 0x07 };
summary["!merges"] = [XLSX.utils.decode_range("A1:B1")];

const second = XLSX.utils.aoa_to_sheet([
  ["ID", "Project", "Cost", "Location"],
  ["B-2", "Shared name", 44, "West sector"],
  ["DUP-7", "Separate phase", true, "East sector"],
]);
const hidden = XLSX.utils.aoa_to_sheet([["ID", "Project"], ["H-1", "Hidden project"]]);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, summary, "District α");
XLSX.utils.book_append_sheet(workbook, second, "District β");
XLSX.utils.book_append_sheet(workbook, hidden, "Reference");
workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };

for (const [name, bookType] of [["portfolio-multi.xlsx", "xlsx"], ["portfolio-multi.xls", "biff8"], ["portfolio-multi.ods", "ods"]]) {
  writeFileSync(path.join(root, name), XLSX.write(workbook, { type: "buffer", bookType, bookSST: true }));
}
writeFileSync(
  path.join(root, "portfolio.csv"),
  "ID,Project,Cost,Location\nC-1,Unicode café,10.50,District 1\nC-2,Second project,11,District 2\n"
);
