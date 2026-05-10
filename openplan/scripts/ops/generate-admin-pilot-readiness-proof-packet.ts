import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  adminPilotReadinessStaticPacket,
  buildAdminPilotReadinessProofPacketMarkdown,
} from "../../src/lib/operations/pilot-readiness-packet";

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, "..");
const outputDir = path.join(repoRoot, "docs", "sales");
const basename = "2026-05-01-openplan-admin-pilot-readiness-proof-packet";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdownTable(lines: string[]) {
  const rows = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));

  const [header, separator, ...bodyRows] = rows;
  if (!header || !separator) return "";

  return [
    '<div class="table-wrap"><table>',
    "<thead><tr>",
    ...header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`),
    "</tr></thead>",
    "<tbody>",
    ...bodyRows.flatMap((row) => ["<tr>", ...row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`), "</tr>"]),
    "</tbody></table></div>",
  ].join("\n");
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let listOpen = false;
  let blockquoteOpen = false;

  function flushParagraph() {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  }

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  function closeBlockquote() {
    if (blockquoteOpen) {
      html.push("</blockquote>");
      blockquoteOpen = false;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      closeBlockquote();
      continue;
    }

    if (trimmed.startsWith("|")) {
      flushParagraph();
      closeList();
      closeBlockquote();
      const tableLines = [trimmed];
      while (index + 1 < lines.length && lines[index + 1].trim().startsWith("|")) {
        index += 1;
        tableLines.push(lines[index].trim());
      }
      html.push(renderMarkdownTable(tableLines));
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      closeBlockquote();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      closeBlockquote();
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph();
      closeList();
      if (!blockquoteOpen) {
        html.push("<blockquote>");
        blockquoteOpen = true;
      }
      html.push(`<p>${renderInlineMarkdown(trimmed.slice(2))}</p>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  closeBlockquote();

  return html.join("\n");
}

function buildHtmlDocument(markdown: string) {
  const body = markdownToHtml(markdown);
  const title = adminPilotReadinessStaticPacket.title;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #5f6b7a;
      --rule: #d8dee8;
      --paper: #f6f3ed;
      --surface: #fffdf8;
      --accent: #22543d;
      --accent-soft: #e7f2ea;
      --warn: #8a5a13;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(180deg, #eee8dc 0%, var(--paper) 36%, #f8f6f0 100%);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.55;
    }
    .sheet {
      width: min(1120px, calc(100% - 40px));
      margin: 28px auto;
      padding: 46px;
      background: var(--surface);
      border: 1px solid rgba(23, 32, 51, 0.12);
      box-shadow: 0 24px 80px rgba(23, 32, 51, 0.12);
    }
    .eyebrow {
      margin: 0 0 12px;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    h1 {
      max-width: 900px;
      margin: 0 0 10px;
      font-size: clamp(2.2rem, 5vw, 4.4rem);
      line-height: 0.95;
      letter-spacing: -0.05em;
    }
    h2 {
      margin: 42px 0 14px;
      padding-top: 22px;
      border-top: 1px solid var(--rule);
      font-size: 1.55rem;
      letter-spacing: -0.03em;
    }
    h3 { margin: 28px 0 8px; font-size: 1.05rem; }
    p { max-width: 890px; margin: 0 0 12px; }
    ul { margin: 0 0 18px 1.15rem; padding: 0; }
    li { margin: 0 0 8px; }
    blockquote {
      margin: 12px 0 22px;
      padding: 12px 16px;
      border-left: 4px solid var(--accent);
      background: var(--accent-soft);
      color: #153528;
      font-weight: 650;
    }
    blockquote p { margin: 0; }
    code {
      padding: 0.1rem 0.28rem;
      border-radius: 0.25rem;
      background: rgba(34, 84, 61, 0.08);
      color: #163c2c;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 0.88em;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 18px 0 28px;
    }
    .pill {
      border: 1px solid rgba(34, 84, 61, 0.22);
      background: rgba(231, 242, 234, 0.8);
      color: var(--accent);
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 0.78rem;
      font-weight: 750;
    }
    .callout {
      margin: 24px 0 34px;
      padding: 18px 20px;
      border: 1px solid rgba(138, 90, 19, 0.24);
      background: #fff7e6;
      color: #513306;
    }
    .table-wrap { width: 100%; overflow-x: auto; margin: 14px 0 24px; }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--rule);
      background: white;
      font-size: 0.88rem;
    }
    th, td {
      vertical-align: top;
      padding: 10px 12px;
      border-bottom: 1px solid var(--rule);
      border-right: 1px solid var(--rule);
      text-align: left;
    }
    th {
      background: #edf3ef;
      color: #173c2d;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: 0; }
    td:last-child, th:last-child { border-right: 0; }
    footer {
      margin-top: 46px;
      padding-top: 18px;
      border-top: 1px solid var(--rule);
      color: var(--muted);
      font-size: 0.82rem;
    }
    @media print {
      body { background: white; }
      .sheet { width: auto; margin: 0; border: 0; box-shadow: none; padding: 28px; }
      h2 { break-after: avoid; }
      table, blockquote { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="sheet" aria-label="${escapeHtml(title)} summary">
    <p class="eyebrow">Buyer-safe supervised pilot proof</p>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span class="pill">Original packet: ${escapeHtml(adminPilotReadinessStaticPacket.originalDate)}</span>
      <span class="pill">Refreshed: ${escapeHtml(adminPilotReadinessStaticPacket.refreshedDate)}</span>
      <span class="pill">Human review before external reliance</span>
      <span class="pill">No broad self-serve SaaS claim</span>
    </div>
    <div class="callout">This generated static packet uses the same final checklist sync, proof filenames, release-proof artifacts, and caveats that the Admin Pilot Readiness markdown export uses.</div>
    ${body.replace(/<h1>.*?<\/h1>\n?/, "")}
    <footer>Generated from <code>openplan/src/lib/operations/pilot-readiness-packet.ts</code> via <code>openplan/scripts/ops/generate-admin-pilot-readiness-proof-packet.ts</code>.</footer>
  </main>
</body>
</html>
`;
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function stripMarkdown(value: string) {
  return value
    .replace(/^#{1,6}\s+/g, "")
    .replace(/^>\s?/g, "")
    .replace(/^[-*]\s+/g, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\|/g, "  ")
    .replace(/---/g, "")
    .trim();
}

function wrapText(value: string, maxLength: number) {
  if (value.length <= maxLength) return [value];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function markdownToPdfLines(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .flatMap((line) => {
      const stripped = stripMarkdown(line);
      if (!stripped) return [""];
      return wrapText(stripped, 92);
    });
}

function buildSimplePdf(markdown: string) {
  const sourceLines = markdownToPdfLines(markdown);
  const linesPerPage = 48;
  const pages: string[][] = [];

  for (let index = 0; index < sourceLines.length; index += linesPerPage) {
    pages.push(sourceLines.slice(index, index + linesPerPage));
  }

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const pageObjectNumbers: number[] = [];

  for (const pageLines of pages) {
    const pageObjectNumber = objects.length;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);

    const commands = ["BT", "/F1 9 Tf", "48 742 Td", "12 TL"];
    for (const line of pageLines) {
      commands.push(`(${pdfEscape(line)}) Tj`, "T*");
    }
    commands.push("ET");
    const stream = commands.join("\n");

    objects[pageObjectNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  }

  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  const chunks = ["%PDF-1.4\n%OpenPlan static sales proof packet\n"];
  const offsets = [0];

  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(chunks.join(""), "utf8");
    chunks.push(`${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`);
  }

  const xrefOffset = Buffer.byteLength(chunks.join(""), "utf8");
  chunks.push(`xref\n0 ${objects.length}\n`);
  chunks.push("0000000000 65535 f \n");

  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    chunks.push(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`);
  }

  chunks.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(""), "utf8");
}

mkdirSync(outputDir, { recursive: true });

const markdown = buildAdminPilotReadinessProofPacketMarkdown();
const html = buildHtmlDocument(markdown);
const pdf = buildSimplePdf(markdown);

const markdownPath = path.join(outputDir, `${basename}.md`);
const htmlPath = path.join(outputDir, `${basename}.html`);
const pdfPath = path.join(outputDir, `${basename}.pdf`);

writeFileSync(markdownPath, `${markdown}\n`);
writeFileSync(htmlPath, html);
writeFileSync(pdfPath, pdf);

console.log(`Wrote ${path.relative(repoRoot, markdownPath)}`);
console.log(`Wrote ${path.relative(repoRoot, htmlPath)}`);
console.log(`Wrote ${path.relative(repoRoot, pdfPath)}`);
