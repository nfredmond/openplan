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
    .replace(/javascript:/gi, "");
}

export function renderChapterMarkdownToHtml(markdown: string | null | undefined): string {
  const source = markdown?.trim();
  if (!source) return "";
  const parsed = marked.parse(source) as string;
  return stripUnsafeHtml(parsed);
}
