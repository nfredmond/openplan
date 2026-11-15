# Engagement job rehearsal record, lane 53

A copy of the record lane 53 assembled on November 14, 2026 from three
rehearsal runs of `qa-harness/engagement-job-journey.js` on a local scratch
stack: Coos County, OR; Lander, WY; and the Hopi Reservation, AZ. It is test
data for `src/test/proven-job-engagement-rehearsal.test.ts`, not evidence:
its base URL is the local dev server, so the checker refuses it as proof.

- `record.json`: the assembled record. The comments in it were typed by the
  journey, are labeled as a demonstration, and represent no one.
- `run2-county/files/`: the county journey's four review files, the bytes the
  local app exported (internal and public PDF and XLSX).
- `run3-city/files/` and `run3-tribal/files/`: the real review workbooks, and
  stand-ins for the two PDFs to keep the folder small. A stand-in holds the
  real PDF's `pdftotext` pages, joined by form feeds, under a two-line
  header, and the record's hash and size for it are re-pinned to the
  stand-in. The test reads a stand-in with a stand-in reader and every other
  file with the checker's own readers.

The builder is kept with lane 53's run files, outside the repository
(`fable-lead/pj2-journey-runs/lane53/tools/build-fixture.mjs` in the
operator state folder).

Lane 61 (November 15, 2026) added to `record.json` what the record schema
now requires and lane 53's run files already held: each journey's `mode`
and `close` (from `run2-county`, `run3-city` and `run3-tribal`, through the
assembler's `closeForRecord`), the journey each participant refusal came
from, and the four limits that say what stays on the journey's word. No
other value changed.
