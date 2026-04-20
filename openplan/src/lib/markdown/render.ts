import { marked, type RendererObject } from "marked";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  newline: "\n",
  quot: '"',
  semi: ";",
  tab: "\t",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return HTML_ENTITY_MAP[normalized] ?? match;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripDangerousHtmlBlocks(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, "")
    .replace(/<embed\b[^>]*\/?>/gi, "")
    .replace(/<link\b[^>]*\/?>/gi, "");
}

function stripRawHtmlToEscapedText(html: string): string {
  const textOnly = stripDangerousHtmlBlocks(html).replace(/<[^>]*>/g, "");
  return escapeHtml(decodeHtmlEntities(textOnly));
}

function normalizeSafeUrl(
  href: string | null | undefined,
  allowedProtocols: Set<string>,
): string | null {
  const decoded = decodeHtmlEntities(href ?? "").trim();
  const compactForProtocolCheck = decoded.replace(/[\u0000-\u001f\u007f\s]+/g, "");
  if (!compactForProtocolCheck) return null;
  if (compactForProtocolCheck.startsWith("//")) return null;
  if (compactForProtocolCheck.startsWith("#") || compactForProtocolCheck.startsWith("/")) {
    return decoded;
  }

  const protocolMatch = compactForProtocolCheck.match(/^([a-z][a-z0-9+.-]*:)/i);
  if (protocolMatch) {
    const protocol = protocolMatch[1].toLowerCase();
    return allowedProtocols.has(protocol) ? decoded : null;
  }

  return decoded;
}

const safeRenderer: RendererObject = {
  html({ text }) {
    return stripRawHtmlToEscapedText(text);
  },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const safeHref = normalizeSafeUrl(href, SAFE_LINK_PROTOCOLS);
    if (!safeHref) return text;

    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(safeHref)}"${titleAttr}>${text}</a>`;
  },
  image({ href, title, text }) {
    const safeHref = normalizeSafeUrl(href, SAFE_IMAGE_PROTOCOLS);
    const alt = escapeHtml(text);
    if (!safeHref) return alt;

    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(safeHref)}" alt="${alt}"${titleAttr}>`;
  },
};

marked.use({
  gfm: true,
  breaks: false,
  async: false,
  renderer: safeRenderer,
});

function wrapTablesForOverflow(html: string): string {
  return html.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (match) => `<div class="chapter-markdown-table-wrap">${match}</div>`,
  );
}

export function renderChapterMarkdownToHtml(markdown: string | null | undefined): string {
  const source = markdown?.trim();
  if (!source) return "";
  const parsed = marked.parse(stripDangerousHtmlBlocks(source)) as string;
  const sanitized = stripDangerousHtmlBlocks(parsed);
  return wrapTablesForOverflow(sanitized);
}
