# Staged uploads browser journey, November 1, 2026

PR 391 moves aerial mission photos and Knowledge Base documents off the
function request body and onto signed Storage uploads (KI-2026-10-12-017).
This note records an agent-run browser journey of that change on a local
build. It is identified-build evidence for the local installation. It is not
evidence about the hosted site.

## Bottom line

On a local build of commit `d481ccc`, a planner account signed up through the
real form, created a project and an aerial mission through the app's own
controls, and uploaded files through each page's file input at 1440 px and
390 px. Every file over 4.5 MB went start, PUT to Storage, complete. The row
recorded the exact byte count and SHA-256 of the chosen file, and the download
served identical bytes. Small files took the same path. A wrong-type document
was refused at start with a readable message and no upload address. A `.jpg`
whose bytes are not an image was staged, refused at complete with a readable
message, and removed. No object remained under `<workspace>/staged/` in either
bucket. A negative control shows that the listing used for that check does see
a staged object when one exists.

## Build identity

| Item | Value |
|---|---|
| Branch and commit | `work/staged-uploads-20261101` at `d481ccc914118f1aefaf62ffe6724cd2a2e50af3` |
| `/api/health` | `status: ok`, `deployment.commit: d481ccc91411`, `version: 0.72.0`, `migrations.expected: 448` |
| Server | `next dev --port 3210` (development mode, webpack), Windows 11 |
| Database and Storage | Local Supabase stack, all 448 migrations applied by `supabase start` |
| Browser | Playwright Chromium 145 (headless), from `qa-harness/` |
| Journey run | 2026-11-02 00:30:55Z to 00:31:18Z (local time November 1) |

### Local stack setup and two deviations

1. **Ports.** Windows on this machine reserves TCP ports 54225 to 54424
   (`netsh interface ipv4 show excludedportrange protocol=tcp`), which covers
   every default port in `openplan/supabase/config.toml`. The first
   `supabase start` failed to bind 54322. No other stack was running. Instead
   of restarting WinNAT (an elevated, machine-wide action), the stack ran from
   a scratch copy of `openplan/supabase/` outside the repository, with ports
   moved to 55320 to 55327, `project_id = "openplan-staged-uploads"`, and
   `site_url` set to `http://localhost:3210`. Its `migrations/` folder was
   byte-identical to the worktree's (`diff -rq`). The repository's config was
   not changed.
2. **Dev server start.** `npm run dev` runs `predev` → `db:sync`, which calls
   `execFileSync("node_modules/.bin/supabase", …)`. On Windows that path is a
   shell shim, so the call fails with `ENOENT` and the script reports only
   "Local migration sync refused". This is a Windows defect in
   `scripts/ops/sync-local-db.mjs`, not part of this PR. Because the stack
   already held all 448 migrations, the sync would have been a no-op, and the
   server was started with `npx next dev --port 3210`.

`.env.local` (gitignored) held the local API URL, the local anon and service
role keys from `supabase status`, `OPENPLAN_SUPABASE_WORKDIR`, and
`OPENPLAN_COMMIT_SHA` set to the commit above so `/api/health` could name it.

## Fixtures

Generated for the journey, not checked in. Hashes are SHA-256.

| File | Bytes | How it was made | SHA-256 |
|---|---:|---|---|
| `large-rtp-exhibit.pdf` | 6,240,941 | `make_pdf.py`: one page, a text line and an uncompressed 1600×1300 RGB image. `pdfinfo` and `pdftotext` both read it. | `81af9503…347991e` |
| `small-staff-report.pdf` | 33,334 | same, 120×90 image | `4802be09…7bf673c6` |
| `large-rtp-exhibit-390.pdf` | 5,625,941 | same, 1500×1250 image (different bytes, so dedupe does not apply) | `72f56110…d5d1c593` |
| `large-mission-frame.jpg` | 6,524,085 | `magick -size 3200x2400 plasma:fractal -seed 7 -quality 97` | `de754699…5634ee` |
| `small-mission-frame.jpg` | 52,184 | `magick -size 640x480 plasma:fractal -seed 3 -quality 85` | `b69c3b7e…cf409b` |
| `large-mission-frame-390.jpg` | 5,920,651 | `magick -size 3000x2300 plasma:fractal -seed 11 -quality 97` | `65976f0f…092b0a95` |
| `model-runner.exe`, `not-a-photo.jpg` | 37 each | the text `MZ this is not a photo or a document` | not needed |

## Journey and results

Navigation at 1440 px: sign up (`/sign-up` form) → dashboard → **Projects** in
the rail → **New project** guided flow → **Documents** in the rail → file
input → **Aerial Imagery** in the rail → launcher project select → **Log a
mission** guided flow → mission link in the list → **Photos** tab → **Upload
photos** input. At 390 px the same account signed in through `/sign-in`, then
went to `/knowledge-base` and the mission page by URL, then the **Photos** tab.
The phone's bottom navigation was not used.

| Viewport | Step | File | Requests (status) | Stored row | Download |
|---|---|---|---|---|---|
| 1440 | KB, large | `large-rtp-exhibit.pdf` | start 200 → PUT 200 → complete 202 | 6,240,941 bytes, `uploaded_pdf`, `stored`, checksum matches | 200, 6,240,941 bytes, SHA-256 matches |
| 1440 | KB, small | `small-staff-report.pdf` | start 200 → PUT 200 → complete 202 | 33,334 bytes, checksum matches | 200, SHA-256 matches |
| 1440 | KB, refused | `model-runner.exe` | start 415, no URL issued | none | not applicable |
| 1440 | Aerial, large | `large-mission-frame.jpg` | start 200 → PUT 200 → complete 201 | 6,524,085 bytes, `image/jpeg`, checksum matches | 200, 6,524,085 bytes, SHA-256 matches |
| 1440 | Aerial, small | `small-mission-frame.jpg` | start 200 → PUT 200 → complete 201 | 52,184 bytes, checksum matches | 200, SHA-256 matches |
| 1440 | Aerial, refused | `not-a-photo.jpg` | start 200 → PUT 200 → complete 415 | none | not applicable |
| 390 | KB, large | `large-rtp-exhibit-390.pdf` | start 200 → PUT 200 → complete 202 | 5,625,941 bytes, checksum matches | 200, SHA-256 matches |
| 390 | Aerial, large | `large-mission-frame-390.jpg` | start 200 → PUT 200 → complete 201 | 5,920,651 bytes, checksum matches | 200, SHA-256 matches |

"Checksum matches" compares the row's recorded SHA-256 (`kb_documents.checksum`,
`aerial_imagery.checksum_sha256`) with the file chosen. "Download" fetches the
app's own download route with the signed-in session, follows its redirect to
the signed Storage URL, and hashes the bytes served. Rows were read with the
local service role.

Messages the planner saw:

- KB success: `Added "large-rtp-exhibit".` (PDF text extraction is queued for
  the Documents worker, which was not running, so the rows stay `stored`.)
- KB refusal: "Unsupported document type. Upload a PDF, Word (.docx),
  plain-text, or Markdown file (these are indexed for citation), or an image
  (JPEG/PNG/TIFF), spreadsheet (.csv/.xlsx/.xls/.ods), CAD file (.dwg/.dxf), or
  office document (.pptx/.ppt/.doc/.rtf/.odt/.odp) to store for reference."
- Aerial refusal: "not-a-photo.jpg: This file is not a JPEG, PNG, or TIFF
  image, which are the formats photogrammetry processing can read. Nothing was
  stored."

### Nothing left under `staged/`

After the aerial refusal, and again at the end, the service role listed
`<workspace>/staged/` in `kb-documents` and `aerial-imagery`, one folder level
at a time as Storage's list API requires. Both were empty.

Negative control, run once against the same workspace after the journey: put
one 3-byte object at `<workspace>/staged/<uuid>/negative-control`, list, delete,
list again. Counts were 0 → 1 → 0 in both buckets (PUT 200, DELETE 200). The
listing therefore reports staged objects when they exist.

### Console

Two errors, both the browser's own "Failed to load resource: the server
responded with a status of 415" for the two intended refusals. Three warnings,
all development-mode font and stylesheet preload notices. No page errors. Signed
URLs and keys were withheld from every capture (`journey.js` strips query
strings and token patterns).

### Screenshots

`screenshots/` holds compressed captures (JPEG, 960 px wide for desktop, 390
px for phone): the dashboard after sign-up, the new project, the mission
dialog, the Photos tab, each upload result, both refusals, and the three 390 px
views. The account shown is a synthetic `@example.test` address.

## What this does not show

- **Hosted behavior.** Local Storage is not hosted Supabase. The local stack
  has a 1 GiB Storage limit and local gateway settings; the hosted project's
  global upload limit and its CORS behavior were not exercised. There is
  no 4.5 MB function body limit locally, so this run shows the staged path
  works end to end but cannot show what the hosted body route would have done.
  One hosted upload above 4.5 MB per door, and one above 50 MB, remain open
  (ROADMAP M5a).
- **Production build.** This was `next dev`, not `next build` and `next start`.
- **Browsers.** Headless Chromium only.
- **Phone navigation.** The 390 px pass reached pages by URL, not through the
  bottom bar or **More** menu.
- **Extraction and OCR.** The Documents worker was not running, so PDF text
  extraction stayed queued.
- **Abandoned uploads.** A staged object whose complete call never comes is
  still not swept; this journey did not create one.

## Found along the way

- `scripts/ops/sync-local-db.mjs` cannot run on Windows (`ENOENT` on the
  `node_modules/.bin/supabase` shim), so `npm run dev` fails at `predev`.
  Outside this PR; reported to the lead.
- The default local Supabase ports fall inside a Windows reserved range on this
  machine. Outside this PR; reported to the lead.
- The Documents page shows upload refusals in a red paragraph without
  `role="alert"`, so a screen reader is not told. Outside this PR.

## Rerun

From `qa-harness/` with the local stack and dev server running:

```bash
OPENPLAN_JOURNEY_BASE_URL=http://localhost:3210 \
OPENPLAN_JOURNEY_API_URL=http://127.0.0.1:55321 \
OPENPLAN_JOURNEY_SERVICE_KEY=<local service role key> \
OPENPLAN_JOURNEY_FIXTURES=<fixture dir> \
OPENPLAN_JOURNEY_OUT=<output dir> \
node ../docs/reviews/2026-11-01-staged-uploads/journey.js
```

The script refuses any base or API URL that is not loopback.
`journey-results.json` is the scrubbed output of the run recorded here.
