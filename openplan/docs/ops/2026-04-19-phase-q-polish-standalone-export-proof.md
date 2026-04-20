# Phase Q polish — standalone-export styling + renderer hardening

**Date:** 2026-04-19
**Slice:** Follow-up to `ff508b6` (chapter markdown rendering) and `20d8e92` (chapter editor preview).
**Status:** Live on main. Tests green (803/172, +6 from this slice). Production build clean.

## Problem

After the earlier Q polish commit, the three in-app render sites parse `content_markdown` correctly — but a prospect who follows the Q.3 one-pager → live demo → **downloads the HTML export** gets an unstyled chapter body. `buildRtpExportHtml` writes a standalone `<!doctype html>` document with its own `<style>` block, and that block had zero `.chapter-markdown` rules. Without the Tailwind/globals.css cascade, the chapter body falls back to browser defaults: default heading sizes, no muted colors, no blockquote border, no table grid. Directly undercuts the outbound-demo path.

Two smaller gaps in the neighborhood:

1. `globals.css:3261` `.chapter-markdown table` had no overflow handling. The Q.2 facility-ranking table is wide enough to break the layout on narrow viewports.
2. `stripUnsafeHtml` in `src/lib/markdown/render.ts` stripped **quoted** event-handler attributes (`onclick="..."`, `onclick='...'`) but not **unquoted** ones (`onclick=alert(1)`). `marked` passes inline HTML through verbatim, so a quirky author could land unquoted handlers in the parsed output.

## Fix shape

One commit. Three source files + two test files + proof doc + continuity.

### 1. `src/lib/rtp/export.ts` — inline `.chapter-markdown` styles

Extended the existing `<style>` block in `buildRtpExportHtml` with the full `.chapter-markdown` ruleset (headings, paragraphs, lists, blockquote, code, pre, table, th/td, a, strong, hr) plus the new `.chapter-markdown-table-wrap` rule. Uses concrete hex colors (`#16202a`, `#3e4a55`, `#c9d1d9`, `#dadfe4`, `#e2e6ea`, `#eef0f2`, `#f4f4f5`) matching the rest of the export's palette, since `var(--foreground)` and `color-mix()` don't resolve in a standalone file.

### 2. `src/lib/markdown/render.ts` — table wrap + unquoted handler strip

Two additions:

```ts
function wrapTablesForOverflow(html: string): string {
  return html.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (match) => `<div class="chapter-markdown-table-wrap">${match}</div>`,
  );
}
```

And one new branch in `stripUnsafeHtml`:

```ts
.replace(/\s+on\w+\s*=\s*[^"'\s>]+/gi, "")
```

Export pipeline is now `marked.parse` → `stripUnsafeHtml` → `wrapTablesForOverflow`.

### 3. `src/app/globals.css` — matching in-app wrapper rule

```css
.chapter-markdown-table-wrap {
  overflow-x: auto;
  margin: 0.8em 0;
  -webkit-overflow-scrolling: touch;
}

.chapter-markdown-table-wrap table {
  margin: 0;
}
```

Ensures the in-app render at `rtp/[rtpCycleId]/{page,document}` handles wide tables the same way the export does.

## Tests added

### `src/test/markdown-render.test.ts` — 5 new tests (now 13 total)

- Unquoted `<div onclick=alert(1)>hi</div>` strips the handler, keeps the text.
- `<svg onload="...">` handler stripped.
- `<img src=x onerror='...'>` handler stripped.
- `<svg><script>alert(1)</script><circle/></svg>` removes the nested script block.
- GFM tables get wrapped in `<div class="chapter-markdown-table-wrap">`.

### `src/test/rtp-export.test.ts` — 1 new test (now 2 total)

Builds a standalone export with a chapter whose markdown contains a blockquote + GFM table. Asserts:

- `<style>...\.chapter-markdown\s*\{` present (inline rules embedded).
- `<style>...\.chapter-markdown-table-wrap\s*\{` present.
- `<div class="chapter-markdown-table-wrap">` wraps the rendered table in the body.
- Numeric cell content survives the wrapping unchanged.

## Verification

| Gate | Result |
|---|---|
| `./node_modules/.bin/tsc --noEmit` | clean |
| `./node_modules/.bin/vitest run src/test/markdown-render.test.ts` | 13/13 |
| `./node_modules/.bin/vitest run src/test/rtp-export.test.ts` | 2/2 |
| `./node_modules/.bin/vitest run` | 803/172 |
| `npm run build` | clean |

## Not changed

- Public engagement portal markdown rendering (`public-engagement-portal.tsx:482`). Different trust boundary — needs a real sanitizer (e.g., `sanitize-html` or `rehype-sanitize`) before we render submitted comments as markdown. Explicitly deferred.
- Regex strip → real sanitizer upgrade. Not needed yet for authenticated `content_markdown`; revisit if/when we extend rendering to untrusted inputs.
- Rendering of `summary` / `guidance` / `priority_rationale` / `campaign.summary` / `cycle.summary`. Those fields were written as plain text; parsing existing content through markdown risks mangling.
