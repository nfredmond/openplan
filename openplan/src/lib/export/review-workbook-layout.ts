import type JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

type ReviewWorksheetLayout = {
  headerRows?: number[];
  freezeHeader?: boolean;
  page?: { orientation: "portrait" | "landscape"; scale: number };
};

const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
// The engagement export's original styles, shared with literal-value portfolio exports.
const reviewStyles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF136B73"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function element(document: Document, name: string, attributes: Record<string, string>): Element {
  const node = document.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/** Format only trusted SheetJS-generated XML. Cell values and formulas remain DOM text nodes. */
export async function formatReviewWorkbook(zip: JSZip, options: {
  recalculate?: boolean;
  worksheets: ReviewWorksheetLayout[];
}): Promise<void> {
  const parser = new DOMParser(), serializer = new XMLSerializer();
  zip.file("xl/styles.xml", reviewStyles, { createFolders: false, date: zip.file("xl/styles.xml")!.date });
  if (options.recalculate) {
    const document = parser.parseFromString(await zip.file("xl/workbook.xml")!.async("string"), "application/xml");
    document.documentElement.appendChild(element(document, "calcPr", { calcId: "0", calcMode: "auto", fullCalcOnLoad: "1", forceFullCalc: "1" }));
    zip.file("xl/workbook.xml", serializer.serializeToString(document), { createFolders: false, date: zip.file("xl/workbook.xml")!.date });
  }
  for (const [index, layout] of options.worksheets.entries()) {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const document = parser.parseFromString(await zip.file(path)!.async("string"), "application/xml");
    const sheet = document.documentElement;
    for (const row of Array.from(sheet.getElementsByTagName("row"))) {
      const header = (layout.headerRows ?? [1]).includes(Number(row.getAttribute("r")));
      for (const cell of Array.from(row.getElementsByTagName("c"))) cell.setAttribute("s", header ? "1" : "2");
    }
    if (layout.freezeHeader !== false) {
      const view = sheet.getElementsByTagName("sheetView")[0];
      view.appendChild(element(document, "pane", { ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" }));
    }
    if (layout.page) {
      // SheetJS emits ignoredErrors after sheetData. Print properties precede it in OOXML order.
      const before = sheet.getElementsByTagName("ignoredErrors")[0] ?? null;
      sheet.insertBefore(element(document, "pageMargins", { left: "0.3", right: "0.3", top: "0.4", bottom: "0.4", header: "0.2", footer: "0.2" }), before);
      sheet.insertBefore(element(document, "pageSetup", { orientation: layout.page.orientation, paperSize: "1", scale: String(layout.page.scale) }), before);
    }
    zip.file(path, serializer.serializeToString(document), { createFolders: false, date: zip.file(path)!.date });
  }
}
