# OpenPlan OCR Worker — Reading Scanned Documents

## What This Does

Your agency's older plans are almost certainly scans: a picture of each page,
with no text inside the file. OpenPlan stores those, lets you download them, and
tells you plainly that it cannot search or quote them. That is honest, and it is
also the single biggest gap in the document library — the adopted plan you most
need to quote is usually the one nobody can search.

This worker closes it. It takes a scanned PDF, runs it through
[OCRmyPDF](https://ocrmypdf.readthedocs.io/) and
[Tesseract](https://tesseract-ocr.github.io/) (both open source, both free), and
hands the recognised text back to OpenPlan **one page at a time** — so an
excerpt can still say which page it came from. Once it finishes, the document is
searchable and quotable like any other, and OpenPlan marks everywhere it is
quoted that the text came from OCR.

**What it will not do.** It transcribes; it does not summarise, tidy up, or
guess. It never reports how confident it is, because that number would look like
a quality judgement and there is nothing behind it. If it cannot read a
document, it says so and the document stays exactly as unreadable as it was.

## What you need before starting

- **Docker with Docker Compose.** The image is about 1 GB and builds in a few
  minutes.
- **Cores more than RAM.** OCR is processor work; 2 GB is plenty of memory, and
  more cores directly means faster. A 200-page scan takes roughly 10–30 minutes
  on four cores.
- A running OpenPlan deployment on the same machine or reachable over the
  network. Same machine is the simple case and what the defaults assume.
- About 10 minutes.

## Step 1 — start the worker

```bash
cd workers/ocr_worker
docker compose up -d --build
```

**What success looks like:** the build installs Tesseract, Ghostscript and
Poppler, which takes a few minutes the first time. When it finishes,
`docker compose ps` shows **one service with STATUS "Up"**: `ocr-worker`.

The worker will print one line and then **exit** if step 2 has not been done yet
— `docker compose logs ocr-worker` will say exactly which variable is missing.
That refusal is deliberate: an unauthenticated OCR endpoint would let anyone
spend this machine's cores and read whatever documents they can name a link to.
Do step 2, then `docker compose up -d` again.

## Step 2 — create the two shared secrets

The worker and OpenPlan authenticate to each other with two bearer tokens: one
for requests going TO the worker, one for results coming BACK. Generate both and
put them in a `.env` file next to `docker-compose.yml`:

```bash
cd workers/ocr_worker
cat > .env <<EOF
OPENPLAN_KB_OCR_WORKER_TOKEN=$(openssl rand -hex 32)
OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN=$(openssl rand -hex 32)
EOF
docker compose up -d
```

**What success looks like:** `docker compose logs ocr-worker` ends with a line
like

```
[ocr-worker] serving on :8585 (contract openplan-ocr-extraction.v1; up to 2000 pages per document; default languages eng)
```

## Step 3 — tell OpenPlan about the worker

In the OpenPlan app's environment (`.env.local` for a local deployment; your
host's environment settings otherwise), set — with the SAME two token values
from step 2:

```
OPENPLAN_KB_OCR_WORKER_URL=http://localhost:8585
OPENPLAN_KB_OCR_WORKER_TOKEN=<the worker token from step 2>
OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN=<the callback token from step 2>
```

Restart the app after changing environment variables.

**All three are required.** OpenPlan treats a URL with no token as *not
configured* and keeps saying so — a half-configured deployment would offer a
button that fails at the worker with a 401 nobody could interpret.

**If your OpenPlan is NOT on this machine**, two things change from their
localhost defaults: `OPENPLAN_KB_OCR_WORKER_URL` (how the app reaches this
worker) and `OPENPLAN_KB_OCR_CALLBACK_URL` on the app side (the address this
machine can reach the app at). See the networking note at the top of
`docker-compose.yml`.

## Step 4 — verify

```bash
curl http://localhost:8585/healthz
```

**What success looks like:** JSON with `"status": "ok"`, `"binaries"` showing
`true` for all three of `ocrmypdf`, `pdfinfo` and `pdftotext`, and
`"languages": ["eng", "osd"]` or similar.

If a binary reads `false`, the image did not build correctly — rebuild with
`docker compose up -d --build`. If `languagesProbe` says `unavailable`, Tesseract
did not answer; that is reported as "could not look", never as "no languages
installed", because those are different problems.

This endpoint reports that the PROCESS is up. It never promises a job will
succeed.

## Step 5 — read a document

In OpenPlan: open **Documents**, find a scanned PDF (it shows the badge
`failed` and a line saying no text layer was found), and click **Read with OCR**.

**What success looks like:** the screen confirms the document was sent. It does
NOT change the badge — OCR takes minutes and the screen will not claim an
outcome nothing has reported yet. Come back and reload: the document shows
`ready` with a chunk count, and a line saying it was read with OCR.

**How long it takes:** roughly 3–10 seconds per page per core. A 40-page staff
report is a couple of minutes; a 400-page adopted RTP can be an hour. Nothing is
lost if you close the tab.

**If it fails**, the document stays exactly as it was — still stored, still
downloadable, still honestly marked unreadable — and the reason is recorded
against the job. Common ones, each with its own sentence: the language pack is
missing, the scan is too faint to recognise anything, the document is longer
than this deployment's page ceiling, or the recognised text is bigger than the
callback ceiling (see below).

## Reading documents that are not in English

**This is the setting most likely to be wrong, and the hardest to notice.** A
Spanish-language plan read with the English model comes back looking exactly
like text, saying nothing, and nothing downstream can tell.

Two steps, both required:

1. **Install the language pack in the image.** Edit `Dockerfile` and add the
   package next to `tesseract-ocr-eng` — Spanish is `tesseract-ocr-spa`,
   Vietnamese `tesseract-ocr-vie`, Simplified Chinese `tesseract-ocr-chi-sim`,
   Tagalog `tesseract-ocr-tgl`, Korean `tesseract-ocr-kor`. Then
   `docker compose up -d --build`.
2. **Tell OpenPlan to ask for it.** Set `OPENPLAN_KB_OCR_LANGUAGES` in the app's
   environment, comma-separated in priority order — for example `spa,eng` for a
   deployment whose documents are mostly Spanish with some English.

The worker **refuses** a language it has no trained data for, naming the code
and listing what it does have, so a mismatch fails loudly on the first job
rather than quietly on every one. Check what an image actually has with:

```bash
docker compose exec ocr-worker tesseract --list-langs
```

## Very large documents, and the one ceiling you may have to raise

The recognised text travels back to OpenPlan in a single HTTP request, so
OpenPlan enforces a size ceiling on it: **4 MiB by default**, roughly a thousand
pages of ordinary plan prose. A document past it FAILS, naming both numbers,
rather than delivering part of itself — a document read only as far as a ceiling
would look, from every screen in OpenPlan, exactly like a document that ends
there.

- **Self-hosted OpenPlan:** raise `OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES` on the
  app side (and any body-size limit in your reverse proxy — nginx's
  `client_max_body_size`).
- **OpenPlan on Vercel:** the platform caps a function's request body at 4.5 MB
  and that cannot be raised. The default sits deliberately underneath it. A
  document bigger than that has to be split before uploading, or OpenPlan
  has to be self-hosted.

The worker measures its result against the ceiling BEFORE sending, so you get a
sentence with both numbers instead of a stalled job.

## Environment variables (worker side)

| Variable | Default | What it does |
| --- | --- | --- |
| `OPENPLAN_KB_OCR_WORKER_TOKEN` | — required | Bearer token OpenPlan presents when dispatching. The worker refuses to start without it. |
| `OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN` | — required | Bearer token this worker presents on callbacks. Must equal the app's value of the same name. |
| `OCR_WORKER_PORT` / `PORT` | `8585` | Port the worker listens on. |
| `OCR_WORKER_WORK_DIR` | `/tmp/ocr_worker_jobs` | Per-job scratch. Deleted after every job. |
| `OCR_WORKER_MAX_QUEUED` | `4` | Jobs held unstarted before the worker answers 503 rather than accepting work it may never reach. |
| `OCR_WORKER_MAX_SOURCE_BYTES` | `209715200` (200 MiB) | Largest PDF this worker will download. |
| `OCR_WORKER_MAX_PAGES` | `2000` | Longer documents are REFUSED whole, never truncated. |
| `OCR_WORKER_TIMEOUT_SECONDS` | `5400` (90 min) | When recognition is stopped and the job fails saying so. |
| `OCR_WORKER_JOBS` | unset | Cores OCRmyPDF may use for one document. Unset lets it decide. |
| `OCR_WORKER_DEFAULT_LANGUAGES` | `eng` | Used ONLY when a request names no languages. OpenPlan always names them. |

## How It Works

1. A planner clicks **Read with OCR** on a scanned PDF. OpenPlan checks their
   role, writes a job row, mints a one-hour signed link to the file, and POSTs
   an OcrRequest here (`/api/v1/ocr-requests`, bearer-authenticated).
2. The worker answers an `accepted` callback body immediately and queues the
   job. One document at a time — OCR saturates every core it can reach, and two
   at once finish later than the same two in sequence.
3. Intake downloads the file and verifies it against the SHA-256 and byte size
   OpenPlan declared. A mismatch fails the job **naming the file**, because
   recognised text becomes citable evidence and text read off a corrupted
   download would be indistinguishable from the real thing.
4. OCRmyPDF adds a text layer (`--skip-text`: a page that already has real
   embedded text keeps it — real text beats recognised text every time), then
   `pdftotext -layout` reads it back out page by page. Table layout is preserved,
   because a plan's fiscal tables are columns and reflowing them destroys the row
   a figure belongs to.
5. **Three page counts must agree** — the source PDF's, the recognised PDF's,
   and how many page blocks came back. If any pair disagrees the job fails
   naming all three. A silently dropped page renumbers every page after it, and
   there is no reader anywhere downstream — not the search index, not a board
   member checking a citation — who could detect that.
6. The worker POSTs a `succeeded` callback carrying one entry per page,
   **including pages that recognised nothing**, which arrive as empty strings.
   OpenPlan turns them into page-anchored chunks with the same code path a
   normal PDF uses, then marks the document readable.
7. Anything that fails, fails with a sentence naming the stage and the cause in
   the job's own record — never a silent stall.

**What a restart forgets.** The worker keeps its queue in memory, not on disk.
If it restarts while a job is queued or running, that job is gone from the
worker's point of view and no callback will ever arrive for it. In OpenPlan the
job simply stays `running` — nothing is corrupted, and nothing is lost either:
the document is untouched and the source file is still in OpenPlan's own
storage. There is no automatic sweep for this yet, so if you restart the worker
deliberately, expect any in-flight document to need the button pressed again
once the old job is cleared. Finished work is never affected: the recognised
text is already in OpenPlan by then.

**What is never kept.** The downloaded PDF and the recognised copy are deleted
when the job ends, whether it succeeded or failed. The worker holds nothing.

## Running the worker's test suites

Plain scripts, no pytest — the same posture as the ODM and AequilibraE workers.
All five run on the standard library alone, with no OCR software installed:

```bash
cd workers/ocr_worker
for f in test_*.py; do python3 "$f" || break; done
```

Inside the built container, one check skips by name instead: the contract enum
cross-check needs the repository's schema file, which is not shipped in the
image.

```bash
docker compose exec ocr-worker sh -c 'for f in test_*.py; do python "$f" || break; done'
```

**What success looks like, either way:** every suite prints its checks and ends
with an "all … checks passed" line; any `SKIPPED` line names what was skipped
and why. A suite that stops early prints the failing assertion — that is a real
failure, not noise.
