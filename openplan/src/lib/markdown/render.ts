import { marked } from "marked";

marked.use({
  gfm: true,
  breaks: false,
  async: false,
});

function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on\w+\s*=\s*[^"'\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

function wrapTablesForOverflow(html: string): string {
  return html.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (match) => `<div class="chapter-markdown-table-wrap">${match}</div>`,
  );
}

export function renderChapterMarkdownToHtml(markdown: string | null | undefined): string {
  const source = markdown?.trim();
  if (!source) return "";
  const parsed = marked.parse(source) as string;
  return wrapTablesForOverflow(stripUnsafeHtml(parsed));
}
