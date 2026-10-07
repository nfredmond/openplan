import * as XLSX from "xlsx";
import JSZip from "jszip";
import { bcaDocumentSchema, type BcaDocument } from "./schema";
import {
  calculateBcaDocument,
  calculateBcaSensitivity,
  calculateBcaComponents,
} from "./engine";
import { getBcaProfile } from "./profiles";

const escaped = (text: unknown) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (value: number | null) =>
  value === null
    ? "Not calculated"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe =
    /^[\s]*[=+@-]/.test(raw) && typeof value !== "number" ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};
function csv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function bcaMemo(doc: BcaDocument) {
  const result = calculateBcaDocument(doc),
    sensitivity = calculateBcaSensitivity(doc),
    profile = getBcaProfile(doc.programId);
  return [
    `# ${doc.title}`,
    "",
    `Calculation status: ${result.status}. Responsible analyst review and program acceptance are not established by this calculation.`,
    "",
    `Project: ${doc.projectId}`,
    `Program: ${profile?.title ?? doc.programId}`,
    `Edition: ${doc.programVersion}`,
    `Method source: ${profile?.source || "Not recorded"}`,
    `Controlling program: ${profile?.controllingSource || "Verify the current notice"}`,
    ...(profile?.requirements ?? []),
    `Applicability: ${doc.applicability || "[VERIFY: applicability]"}`,
    "",
    `## Scope`,
    doc.geography,
    `No Build: ${doc.noBuildDescription}`,
    `Build: ${doc.alternative}`,
    "",
    `## Method`,
    doc.methodology,
    `Dollar year ${doc.priceYear}; discount epoch ${doc.discountYear}; real rate ${doc.discountRatePct}%; analysis ${doc.startYear} to ${doc.endYear}; opens ${doc.openingYear}.`,
    "Reduction benefits = (No Build minus Build) × annualization × unit value × dollar conversion. Increase benefits, including residual value, use Build minus No Build. Costs reverse the quantity difference. Annual overrides replace the base quantities and unit value for that year. Growth applies only in years without an override. All flows occur at year end; the discount epoch has exponent zero.",
    doc.costConvention === "capital-only"
      ? "BCR uses capital in the denominator. Net operating/rehabilitation costs reduce the numerator. Residual is entered as a final-year benefit."
      : "BCR includes all incremental costs in the denominator. This follows the Cal-B/C state accounting convention; it differs from USDOT's capital-only denominator.",
    "",
    `## Results`,
    `BCR: ${result.benefitCostRatio?.toFixed(3) ?? "Not calculated"}`,
    `Net present value: ${money(result.netPresentValue)}`,
    `Present-value numerator: ${money(result.presentValueBenefits)}`,
    `Present-value denominator: ${money(result.presentValueCosts)}`,
    result.complete
      ? ""
      : "These subtotals omit incomplete streams. They are not a project result.",
    "",
    `## Project elements`,
    "Allocate shared costs and effects once. Element ratios are not additive.",
    ...calculateBcaComponents(doc).map(
      ({ component, result: r }) =>
        `${component}: BCR ${r.benefitCostRatio?.toFixed(3) ?? "not calculated"}; NPV ${money(r.netPresentValue)}; ${r.issues.length} open checks.`,
    ),
    "",
    `## Sensitivity`,
    doc.sensitivity.rationale,
    "These scenarios are assumptions, not confidence intervals.",
    ...sensitivity.cases.map(
      (row) =>
        `${row.label}: BCR ${row.bcr?.toFixed(3) ?? "not calculable"}; NPV ${money(row.npv)}. ${row.issues.map(issue => issue.message).join(" ")}`,
    ),
    "",
    `## Review worklist`,
    ...result.issues.map((issue) => `- ${issue.severity}: ${issue.message}`),
    "",
    `## Benefits not monetized`,
    doc.qualitativeBenefits ||
      "None recorded. This does not establish that none exist.",
    "",
    `## Exclusions`,
    doc.exclusions || "[VERIFY: exclusions]",
    "",
    `## Analyst review`,
    doc.reviewNotes || "Not recorded. No approval is inferred.",
    "",
    `## Sources`,
    ...doc.evidence.map(
      (source) =>
        `- ${source.id}: ${source.title}. ${source.reference}, ${source.locator}. Status: ${source.status}. Method: ${source.method}. Limitation: ${source.limitation}. Owner: ${source.owner || "unassigned"}; due: ${source.dueDate || "unset"}.`,
    ),
    "",
    `## Reuse`,
    "OpenPlan supporting analysis. This is not a native Cal-B/C workbook and does not execute its macros. Review required program forms separately. The XLSX has editable annual inputs and formulas; source/review checks are a snapshot and do not refresh when Excel inputs change. Return changes to OpenPlan for a new review and retained version.",
    "",
  ].join("\n");
}

export function bcaWorkbook(doc: BcaDocument) {
  const result = calculateBcaDocument(doc);
  const book = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    [doc.title],
    ["Status", result.status],
    ["Dollar year", doc.priceYear],
    ["Discount year", doc.discountYear],
    ["Default real discount rate", doc.discountRatePct / 100],
    ["BCR convention", doc.costConvention],
    ["PV benefits / numerator", result.presentValueBenefits],
    ["PV costs / denominator", result.presentValueCosts],
    ["Net present value", result.netPresentValue],
    ["Benefit-cost ratio", result.benefitCostRatio],
    [
      "Review",
      "Calculation does not establish grant acceptance. Review worklist and sources.",
    ],
    [
      "Workbook editing",
      "Annual inputs are editable. Recalculate and return changes to OpenPlan; review checks do not refresh in this workbook.",
    ],
    ["Program", doc.programId],
    ["Program edition", doc.programVersion],
    ["Method", doc.methodology],
    [
      "Completeness",
      result.complete
        ? "Complete numerical inputs"
        : "INCOMPLETE: subtotals omit missing streams; no valid project ratio.",
    ],
  ]);
  summary.B5.z = "0.0%";
  const headings = [
    "Flow id",
    "Label",
    "Economic side",
    "Category",
    "Year",
    "No Build",
    "Build",
    "Annualization",
    "Unit value",
    "Dollar conversion",
    "Discount rate",
    "Years from epoch",
    "Signed quantity",
    "Annual value",
    "Present value",
    "BCR numerator",
    "BCR denominator",
    "Benefit direction",
    "Rate override",
    "Project element",
    "Quantity unit",
    "Quantity source ids",
    "Valuation source id",
  ];
  const ledger = XLSX.utils.aoa_to_sheet([
    headings,
    ...result.rows.map((row) => [
      row.flowId,
      row.label,
      row.side,
      row.category,
      row.year,
      row.noBuild,
      row.build,
      row.annualization,
      row.unitValue,
      row.priceFactor,
      row.rate / 100,
      row.discountYears,
      row.quantity,
      row.value,
      row.presentValue,
      0,
      0,
      doc.flows.find((f) => f.id === row.flowId)!.benefitDirection,
      doc.flows.find((f) => f.id === row.flowId)!.discountRatePct === null
        ? null
        : doc.flows.find((f) => f.id === row.flowId)!.discountRatePct! / 100,
      doc.flows.find((f) => f.id === row.flowId)!.component,
      doc.flows.find((f) => f.id === row.flowId)!.unit,
      doc.flows.find((f) => f.id === row.flowId)!.sourceIds.join("; "),
      doc.flows.find((f) => f.id === row.flowId)!.parameterSourceId,
    ]),
  ]);
  result.rows.forEach((row, index) => {
    const n = index + 2;
    const formulas: Record<string, { f: string; v: number }> = {
      K: { f: `IF(ISNUMBER(S${n}),S${n},Summary!$B$5)`, v: row.rate / 100 },
      L: { f: `E${n}-Summary!$B$4`, v: row.discountYears },
      M: {
        f: `IF(AND(C${n}="benefit",R${n}="reduction"),F${n}-G${n},G${n}-F${n})`,
        v: row.quantity,
      },
      N: { f: `M${n}*H${n}*I${n}*J${n}`, v: row.value },
      O: { f: `N${n}/(1+K${n})^L${n}`, v: row.presentValue },
      P: {
        f: `IF(C${n}="benefit",O${n},IF(AND(Summary!$B$6="capital-only",D${n}<>"capital"),-O${n},0))`,
        v:
          result.ratioRows[index].ratioSide === "benefit"
            ? result.ratioRows[index].ratioValue
            : 0,
      },
      Q: {
        f: `IF(AND(C${n}="cost",OR(Summary!$B$6="all-costs",D${n}="capital")),O${n},0)`,
        v:
          result.ratioRows[index].ratioSide === "cost"
            ? result.ratioRows[index].ratioValue
            : 0,
      },
    };
    for (const [column, cell] of Object.entries(formulas))
      ledger[`${column}${n}`] = {
        t: "n",
        ...cell,
        z: "#,##0.00;[Red](#,##0.00)",
      };
    ledger[`K${n}`].z = "0.0%";
  });
  if (result.rows.length) {
    summary.B7 = {
      t: "n",
      f: `SUM(Ledger!P2:P${result.rows.length + 1})`,
      v: result.presentValueBenefits,
    };
    summary.B8 = {
      t: "n",
      f: `SUM(Ledger!Q2:Q${result.rows.length + 1})`,
      v: result.presentValueCosts,
    };
    if (result.complete) {
      summary.B9 = { t: "n", f: "B7-B8", v: result.netPresentValue! };
      summary.B10 = {
        t: "n",
        f: 'IF(B8>0,B7/B8,"Not calculated")',
        v: result.benefitCostRatio!,
      };
    }
  }
  for (const cell of ["B7", "B8", "B9"])
    if (summary[cell]) summary[cell].z = '"$"#,##0;[Red]("$"#,##0)';
  if (summary.B10) summary.B10.z = "0.000";
  summary["!cols"] = [{ wch: 28 }, { wch: 100 }];
  ledger["!cols"] = headings.map((_, i) => ({
    wch: i === 1 ? 40 : i < 4 ? 22 : 20,
  }));
  ledger["!autofilter"] = { ref: `A1:T${result.rows.length + 1}` };
  const components = XLSX.utils.json_to_sheet(
    calculateBcaComponents(doc).map(({ component, result: r }) => ({
      element: component,
      bcr: r.benefitCostRatio,
      npv: r.netPresentValue,
      numerator: r.presentValueBenefits,
      denominator: r.presentValueCosts,
      checks_at_export: r.issues.length,
      status_at_export: r.status,
    })),
  );
  if (result.rows.length)
    calculateBcaComponents(doc).forEach(({ result: r }, index) => {
      const n = index + 2,
        last = result.rows.length + 1;
      components[`D${n}`] = {
        t: "n",
        f: `SUMPRODUCT(--EXACT(Ledger!$T$2:$T$${last},A${n}),Ledger!$P$2:$P$${last})`,
        v: r.presentValueBenefits,
      };
      components[`E${n}`] = {
        t: "n",
        f: `SUMPRODUCT(--EXACT(Ledger!$T$2:$T$${last},A${n}),Ledger!$Q$2:$Q$${last})`,
        v: r.presentValueCosts,
      };
      if (r.complete) {
        components[`B${n}`] = {
          t: "n",
          f: `IF(E${n}>0,D${n}/E${n},"Not calculated")`,
          v: r.benefitCostRatio!,
        };
        components[`C${n}`] = {
          t: "n",
          f: `D${n}-E${n}`,
          v: r.netPresentValue!,
        };
      }
    });
  components["!cols"] = [
    { wch: 35 },
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 20 },
    { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(book, components, "Elements");
  const sources = XLSX.utils.json_to_sheet(doc.evidence);
  sources["!cols"] = [
    { wch: 22 },
    { wch: 40 },
    { wch: 75 },
    { wch: 40 },
    { wch: 16 },
    { wch: 20 },
    { wch: 65 },
    { wch: 65 },
    { wch: 25 },
    { wch: 16 },
  ];
  const inputs = XLSX.utils.json_to_sheet(
    doc.flows.map((flow) => ({
      ...flow,
      sourceIds: flow.sourceIds.join(", "),
      annualOverrides: JSON.stringify(flow.annualOverrides),
    })),
  );
  inputs["!cols"] = Object.keys(doc.flows[0] ?? {}).map(() => ({ wch: 24 }));
  const issues = XLSX.utils.json_to_sheet(
    result.issues.length
      ? result.issues
      : [
          {
            code: "none",
            severity: "review",
            message:
              "No automated issues. Human method and source review remains required.",
          },
        ],
  );
  issues["!cols"] = [{ wch: 25 }, { wch: 15 }, { wch: 110 }, { wch: 25 }];
  for (const [name, sheet] of [
    ["Summary", summary],
    ["Ledger", ledger],
    ["Inputs", inputs],
    ["Sources", sources],
    ["Review", issues],
  ] as const)
    XLSX.utils.book_append_sheet(book, sheet, name);
  return book;
}

/** Ask spreadsheet clients to recompute formulas instead of trusting cached values. */
export async function bcaWorkbookBytes(doc: BcaDocument) {
  const archive = await JSZip.loadAsync(
    XLSX.write(bcaWorkbook(doc), { type: "array", bookType: "xlsx" }),
  );
  const xml = await archive.file("xl/workbook.xml")!.async("string");
  archive.file(
    "xl/workbook.xml",
    xml
      .replace(/<calcPr\b[^>]*\/>/g, "")
      .replace(
        "</workbook>",
        '<calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
      ),
  );
  return archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export function bcaHtml(doc: BcaDocument) {
  const result = calculateBcaDocument(doc);
  const narrative = bcaMemo(doc)
    .split("\n")
    .filter((line) => !line.startsWith("# "))
    .map((line) =>
      line.startsWith("## ")
        ? `<h2>${escaped(line.slice(3))}</h2>`
        : line
          ? `<p>${escaped(line)}</p>`
          : "",
    )
    .join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaped(doc.title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#172f35;max-width:1000px;margin:auto;padding:32px}h1{font-size:30px}table{border-collapse:collapse;width:100%}th,td{text-align:right;padding:9px;border-bottom:1px solid #ccd6d6}th:first-child,td:first-child{text-align:left}p{margin:.4em 0;overflow-wrap:anywhere}h2{margin-top:1.2em;break-after:avoid} @media print{body{padding:0;font-size:10pt}tr{break-inside:avoid}h2{break-after:avoid}}</style><h1>${escaped(doc.title)}</h1><p>${escaped(result.status)}. ${doc.priceYear} dollars. BCR ${result.benefitCostRatio?.toFixed(3) ?? "not calculated"}; NPV ${money(result.netPresentValue)}.</p><h2>Annual economic cash flows</h2><table><thead><tr><th>Year</th><th>Benefits</th><th>Costs</th><th>Net</th><th>Discounted net</th></tr></thead><tbody>${result.annual.map((row) => `<tr><td>${row.year}</td><td>${money(row.benefits)}</td><td>${money(row.costs)}</td><td>${money(row.net)}</td><td>${money(row.presentValueNet)}</td></tr>`).join("")}</tbody></table><h2>Method, sources and review</h2><section>${narrative}</section></html>`;
}

export async function exportBcaPackage(
  input: BcaDocument,
  additionalFiles: Record<string, Uint8Array | string> = {},
) {
  const doc = bcaDocumentSchema.parse(input),
    result = calculateBcaDocument(doc);
  const zip = new JSZip();
  const files: Record<string, string | Uint8Array> = {
    "manifest.json": JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        engineVersion: result.engineVersion,
        projectId: doc.projectId,
        programId: doc.programId,
        programVersion: doc.programVersion,
        priceYear: doc.priceYear,
        currency: "USD",
        status: result.status,
      },
      null,
      2,
    ),
    "analysis.json": JSON.stringify(doc, null, 2),
    "result.json": JSON.stringify(result, null, 2),
    "method-and-review.md": bcaMemo(doc),
    "report.html": bcaHtml(doc),
    "annual-ledger.csv": csv([
      [
        "flow_id",
        "label",
        "side",
        "category",
        "year",
        "no_build",
        "build",
        "quantity",
        "annualization",
        "unit_value",
        "price_factor",
        "annual_dollars",
        "rate_percent",
        "discount_years",
        "present_value",
        "quantity_unit",
        "project_element",
        "quantity_source_ids",
        "valuation_source_id",
      ],
      ...result.rows.map((r) => [
        r.flowId,
        r.label,
        r.side,
        r.category,
        r.year,
        r.noBuild,
        r.build,
        r.quantity,
        r.annualization,
        r.unitValue,
        r.priceFactor,
        r.value,
        r.rate,
        r.discountYears,
        r.presentValue,
        doc.flows.find((flow) => flow.id === r.flowId)!.unit,
        doc.flows.find((flow) => flow.id === r.flowId)!.component,
        doc.flows.find((flow) => flow.id === r.flowId)!.sourceIds.join("; "),
        doc.flows.find((flow) => flow.id === r.flowId)!.parameterSourceId,
      ]),
    ]),
    "source-register.csv": csv([
      [
        "id",
        "title",
        "reference",
        "locator",
        "year",
        "status",
        "method",
        "limitation",
        "owner",
        "due",
      ],
      ...doc.evidence.map((s) => [
        s.id,
        s.title,
        s.reference,
        s.locator,
        s.observedYear,
        s.status,
        s.method,
        s.limitation,
        s.owner,
        s.dueDate,
      ]),
    ]),
    "calculation.xlsx": await bcaWorkbookBytes(doc),
    "README.txt":
      "Open report.html in a browser and print to PDF. calculation.xlsx is unlocked and formula-based. analysis.json restores the full OpenPlan document. CSV contains completed annual streams only; result.json and the memo list omissions. This package is not a native Cal-B/C file or a grant submission. No source attachments are embedded. Retain referenced originals separately. SHA-256 checksums cover file bytes, not professional validity.\n",
  };
  Object.assign(files, additionalFiles);
  const checksums = [];
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    checksums.push(
      `${Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}  ${name}`,
    );
  }
  zip.file("SHA256SUMS.txt", checksums.join("\n") + "\n");
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
