# Markdown renderer DOM-free hardening (2026-04-20)

## What shipped

Replaced the regex-only `stripUnsafeHtml` path in `src/lib/markdown/render.ts` with a DOM-free safe `marked` renderer. The public `renderChapterMarkdownToHtml(markdown)` signature is unchanged — chapter editor preview, both RTP read sites, and `buildRtpExportHtml` keep the same call shape and table wrapping behavior.

The first implementation of this slice used `isomorphic-dompurify`, but production build review caught that it bundled `jsdom` into the Next server path and failed page-data collection for `/api/reports/[reportId]/generate`. The final implementation removes that dependency entirely.

## Why this shape

Chapter markdown is a planner-authored markdown surface, not an arbitrary HTML embedding surface. The renderer therefore supports markdown-generated structure and treats raw HTML as unsupported input:

- GFM headings, paragraphs, emphasis, blockquotes, lists, tables, code, and safe markdown links still render.
- Raw HTML tags are stripped; visible non-tag text survives where safe.
- Dangerous raw blocks (`script`, `style`, `iframe`, `object`, `embed`, `link`) are stripped before markdown parsing and again after rendering as defense in depth.
- Markdown link/image URLs are allowlisted after HTML-entity decoding. Links allow `http:`, `https:`, `mailto:`, `tel:`, root-relative paths, relative paths, and hash links. Images allow `http:` and `https:` plus relative paths. `javascript:`, `vbscript:`, protocol-relative URLs, `data:text/html`, and entity-obfuscated variants are rejected.

This keeps the sanitizer build-safe in Next.js server bundles and removes the `jsdom` runtime asset class that caused the deployability failure.

## Tests

`src/test/markdown-render.test.ts` now has 17 tests. Coverage includes:

- markdown rendering correctness for headings, emphasis, blockquotes, and GFM tables,
- table wrapping via `.chapter-markdown-table-wrap`,
- safe markdown links preserved,
- unsafe markdown link URLs degraded to text without `href`,
- raw `<script>`, event handlers, iframe/object/embed/link, SVG script/onload, raw image `onerror`, entity-encoded `javascript:`, `data:text/html`, `<style>`, and inline `style=` stripped.

`src/test/gtfs-child-policies.test.ts` is part of the same P1 repair slice and covers the database review finding: it asserts GTFS child policies inherit `gtfs_feeds` visibility and that the corrective migration exists.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit                                                   # exit 0
pnpm exec vitest run src/test/markdown-render.test.ts src/test/gtfs-child-policies.test.ts  # exit 0; 2 files · 19 tests
pnpm test -- --run                                                       # exit 0; 175 files · 824 tests
pnpm lint                                                                # exit 0; 0 warnings
pnpm build                                                               # exit 0
```

Full `pnpm qa:gate` is recorded in `docs/ops/2026-04-20-p1-review-repair-proof.md`.

## Files

- `openplan/src/lib/markdown/render.ts` — DOM-free safe renderer + URL allowlist; no top-level DOM sanitizer import.
- `openplan/src/test/markdown-render.test.ts` — +4 hardening assertions since the 13-test baseline.
- `openplan/src/test/gtfs-child-policies.test.ts` — migration regression test for the paired P1 RLS repair.
- `openplan/package.json` / `openplan/pnpm-lock.yaml` — removed `isomorphic-dompurify`.

## Not this slice

- Enforcing CSP. CSP remains report-only until violation data is observed.
- Rich raw HTML support in chapters. Markdown syntax is the supported authoring interface.
- A broader markdown/MDX editor redesign.
