# Phase Q.4 — Report PDF export proof (2026-04-20)

## What shipped

`POST /api/reports/[reportId]/generate` now honors `format: "pdf"` end-to-end. The prior 501 stub is gone. Both route branches (RTP cycle packet + structured project report) render the same HTML they already produced, pipe it through headless Chromium, upload the PDF to a new workspace-scoped Supabase Storage bucket, and persist the artifact row with `artifact_kind: "pdf"` + `storage_path`. The report row's `latest_artifact_kind` is updated to match.

This unblocks the Phase Q → revenue motion: the RTP packet and (when the Q.3 outbound one-pager is pointed at the same pipeline) the sales packet are now sendable as PDFs without a vendor dependency.

## Route branches wired

`src/app/api/reports/[reportId]/generate/route.ts`

Both branches share the same pattern:

1. Existing quota + subscription gate runs unchanged before the branch split.
2. Existing HTML is built via `buildRtpExportHtml` (RTP branch) or `buildReportHtml` (project branch) — unchanged.
3. If `format === "pdf"`:
   - Pre-generate `artifactId = crypto.randomUUID()` so the storage path and the `report_artifacts.id` stay in sync.
   - Call `renderHtmlToPdf(html)` inside a try/catch — render failure returns 500 + `audit.error("report_pdf_render_failed", ...)`.
   - Upload to `report-artifacts/{workspace_id}/{report_id}/{artifactId}.pdf` with `contentType: "application/pdf", upsert: false`. Upload failure returns 500 + audit.
4. Insert `report_artifacts` with explicit `id: artifactId`, `artifact_kind: format` (`"pdf"` or `"html"`), and `storage_path` (non-null for PDFs, null for HTML — HTML stays inline in `artifact_html`).
5. Update the report row's `latest_artifact_kind` to `format` (both primary and fallback update paths).
6. Response payload gains `format` + `storagePath` alongside the existing `artifactId` + `latestArtifactUrl`.
7. `generationMode` string differentiates: `rtp_pdf_packet` / `rtp_html_packet` (RTP branch), `structured_pdf_packet` / `structured_html_packet` (project branch).

## @sparticuz/chromium rationale

Full Chromium is ~170 MB uncompressed — exceeds Vercel's 250 MB serverless function bundle limit once puppeteer-core + the rest of the route's deps pack in. `@sparticuz/chromium@^129` ships a Lambda/Vercel-tuned Chromium at ~57 MB compressed, maintained specifically for this use case. It pairs directly with `puppeteer-core` (no bundled browser) via the documented `executablePath: await chromium.executablePath()` handshake.

**Dev/prod detection** (in `src/lib/reports/pdf.ts`):
```ts
process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined
```
- Prod path uses `@sparticuz/chromium` (lazy `await import` to keep cold-start cost off non-PDF paths).
- Dev path uses `process.env.CHROME_EXECUTABLE_PATH ?? "/usr/bin/google-chrome"` — same binary Playwright already uses locally.

Both paths share the render core: `page.setContent(html, { waitUntil: "networkidle0" })`, then `page.pdf({ format, printBackground: true, margin })`. `browser.close()` in `finally`.

**Alternative rejected:** `@react-pdf/renderer` — would require re-authoring the report templates in its component vocabulary, duplicating the HTML export path we just invested in for Q.2 and Q polish. Sticking with puppeteer reuses `buildReportHtml`, `buildRtpExportHtml`, `renderChapterMarkdownToHtml`, and the embedded `.chapter-markdown` CSS block from the standalone-export slice.

## New storage bucket

Migration `supabase/migrations/20260420000060_report_artifacts_bucket.sql` creates the `report-artifacts` private bucket:

- `public: false`, 50 MB file limit, mime types: `application/pdf`, `text/html`, `application/octet-stream`.
- RLS gated on the path convention `<workspace_id>/<report_id>/<artifact_id>.ext`:
  - `report_artifacts_workspace_read` — SELECT where `split_part(name, '/', 1)` is in the caller's `workspace_members.workspace_id::text`.
  - `report_artifacts_workspace_insert` — INSERT with the same check.
- Both policies `IF NOT EXISTS`-guarded so the migration is idempotent.

Applied to production via `mcp__supabase__apply_migration`; bucket is live on project `aggphdqkanxsfzzoxlbk`.

## Vercel config

`vercel.json`:
```json
{
  "functions": {
    "src/app/api/reports/[reportId]/generate/route.ts": {
      "maxDuration": 60,
      "memory": 1024
    }
  }
}
```

Chromium needs headroom — 1 GB memory + 60s duration is well within Pro default (300s / Fluid Compute) and fits the Hobby ceiling.

## Tests

Extended `src/test/report-generate-route.test.ts` (rather than creating a sibling file — the existing mock scaffolding was too expensive to duplicate):

- New mocks: `storageUploadMock`, `storageFromMock`, `renderHtmlToPdfMock`, plus `vi.mock("@/lib/reports/pdf", ...)`.
- Default happy-path mocks: upload returns `{ error: null }`, render returns `Buffer.from("fake-pdf-bytes")`.
- Replaced the old "returns 501 for pdf generation requests" test with three new cases:
  1. **PDF artifact persistence** — asserts storage path format `<workspace>/<report>/<uuid>.pdf`, `contentType: "application/pdf"`, `upsert: false`, `artifact_kind: "pdf"`, `latest_artifact_kind: "pdf"`, response includes `format: "pdf"` and `storagePath`.
  2. **Render failure → 500** — `renderHtmlToPdfMock.mockRejectedValueOnce(...)`.
  3. **Upload failure → 500** — `storageUploadMock.mockResolvedValueOnce({ error: ... })`.

The real-browser smoke test is intentionally **not** in CI — it would spawn Chromium on every test run. Local smoke command (below) is the proof of real rendering.

## Gates

Run from `openplan/`:

```bash
pnpm exec tsc --noEmit      # exit 0, clean
pnpm lint                   # 0 errors (52 pre-existing dead-code warnings unchanged)
pnpm test -- --run          # Test Files 172 passed · Tests 806 passed · 11.82s
```

## Local smoke test

```bash
pnpm dev  # one terminal

# another terminal (replace <id> with a real report id from your local workspace):
curl -X POST http://localhost:3000/api/reports/<id>/generate \
  -H "content-type: application/json" \
  --cookie "$(cat ~/.openplan-local-cookie)" \
  -d '{"format":"pdf"}' | jq

# response: { artifactId, format: "pdf", storagePath, latestArtifactUrl }
# fetch the PDF from Supabase Storage via the signed URL or local bucket path.
```

For the production smoke (after deploy): hit the NCTC demo workspace (`d0000001-0000-4000-8000-000000000001`), generate a PDF for the RTP cycle, download via signed URL. PDF should include Q.2 Existing Conditions chapter with correct table formatting and the screening-grade caveat blockquote.

## Critical files

- `openplan/package.json` — +`puppeteer-core@^23.11.1`, +`@sparticuz/chromium@^129.0.0`
- `openplan/src/lib/reports/pdf.ts` — new, ~40 LOC
- `openplan/src/app/api/reports/[reportId]/generate/route.ts` — 501 removed; PDF branch inserted in both `rtp_cycle_id` and project code paths
- `openplan/supabase/migrations/20260420000060_report_artifacts_bucket.sql` — new bucket + RLS
- `openplan/vercel.json` — new
- `openplan/src/test/report-generate-route.test.ts` — +3 PDF tests (806 total)

## Queued follow-ups (not this slice)

- **T16 reader-gate design decision** — writer done; reader posture call still pending.
- **Security-advisor scoping doc** — GTFS RLS-no-policy, two SECURITY DEFINER views, ~40 mutable-search-path trigger functions. Important before first external customer.
- **Markdown renderer hardening** — keep the shared chapter renderer sanitized without pulling DOM-backed libraries into the Next server bundle.
- **Quota sweep** — 77 uncovered endpoints from the Phase O.1 proof.
- **Q.3 outbound one-pager PDF** — once the human-owned pricing/tone/demo-posture decisions land, point the same puppeteer path at `renderChapterMarkdownToHtml(q3_markdown)` to produce the sales one-pager PDF with zero new infrastructure.
