# Phase Q polish — chapter `content_markdown` rendering

**Date:** 2026-04-19
**Slice:** Follow-up polish after Phase Q.2 shipped the NCTC Existing Conditions chapter.
**Status:** Live on main. Tests green (797/172, +8 from the new renderer suite). Production build clean.

## Problem

Phase Q.2 composed a rich-markdown chapter body (headings, a blockquote warning, a GFM table, lists, bold emphasis) and wrote it to `rtp_cycle_chapters.content_markdown`. But the three surfaces that show `content_markdown` all rendered it as **raw text inside `whitespace-pre-wrap`** — no markdown parser anywhere in the read path.

Affected sites before the fix:

- `src/app/(app)/rtp/[rtpCycleId]/page.tsx` — cycle detail chapter stack (line ~619).
- `src/app/(app)/rtp/[rtpCycleId]/document/page.tsx` — document-mode renderer (line ~405).
- `src/lib/rtp/export.ts` — HTML export used by `/api/rtp-cycles/[id]/export?format=html` (line ~240).

Symptom: the NCTC demo chapter would read as `# Existing conditions...` with literal pipes and hash marks, undermining exactly the surface the outbound one-pager points prospects at.

Out of scope (intentionally unchanged): `/api/rtp-cycles/[id]/export?format=txt` at `src/app/api/rtp-cycles/[rtpCycleId]/export/route.ts:129` — `.txt` exports correctly send raw markdown.

## Fix shape

One dep, one helper, three call-site swaps, theme-adaptive CSS.

### New dep

```
"marked": "^14.1.4"
```

Single, server-safe, sync parse, zero peer-dep tail. Used elsewhere in the Node ecosystem as the go-to server-side renderer.

### New helper — `src/lib/markdown/render.ts`

```ts
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
```

### Threat model note

`content_markdown` is writable by authenticated workspace members via the PATCH route (RLS-scoped). That puts this squarely in the "trusted-but-defensively-hardened" bucket, not "arbitrary internet input." The strip is a second layer, not the primary boundary.

### Call-site swaps

Each of the three surfaces swapped the raw-text render for a conditional div with `dangerouslySetInnerHTML` and the `chapter-markdown` class. The empty-state string ("No draft chapter content yet.") is still rendered as plain text.

### CSS

Appended a `.chapter-markdown` block to `src/app/globals.css` covering h1–h4, p, ul/ol, li, blockquote, code, pre, table/th/td, a, strong, hr. Uses `color-mix(in srgb, var(--foreground) N%, transparent)` + `var(--muted, #f4f4f5)` so the chapter body stays legible in both themes without a palette audit.

## Tests

New file: `src/test/markdown-render.test.ts` — 8 unit tests on `renderChapterMarkdownToHtml`:

1. Empty/null/undefined/whitespace → empty string.
2. Headings, bold, italic → expected HTML tags.
3. GFM tables (with right-align spec) → `<table>` + `<th>` + `<td align="right">`.
4. Blockquote caveats → `<blockquote>`.
5. `<script>…</script>` stripped.
6. `onclick=` / `onmouseover=` stripped.
7. `javascript:` protocol stripped.
8. `<iframe>`, `<object>`, `<embed>`, `<link>` all stripped; safe text preserved.

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run src/test/markdown-render.test.ts` | 8/8 |
| `npx vitest run` | 797/172 |
| `npm run build` | clean, all routes compiled |

## What this unblocks

The NCTC demo workspace — once `pnpm seed:nctc` is run against live Supabase — now presents the Existing Conditions chapter at `/rtp/[rtpCycleId]` and `/rtp/[rtpCycleId]/document` as a properly rendered document, not a wall of raw markdown. The HTML export path also benefits without further work.

## Not changed

- `.txt` export path (correctly raw).
- PATCH route sanitation at write time — still only the read-side strip layer. If we later expose chapter editing to less-trusted roles, the right move is a proper server-side sanitizer (rehype-sanitize) at the write boundary, not here.
