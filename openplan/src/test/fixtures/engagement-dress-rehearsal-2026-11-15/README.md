# Engagement job dress rehearsal, November 15, 2026

Test data for `qa-harness/engagement-job-review-59.test.js`, not evidence.
The lead ran three rehearsal journeys of `qa-harness/engagement-job-journey.js`
on a local scratch stack at commit `65aba74fb3bd` (Coos County, OR; a Wyoming
town; the Hopi Reservation, AZ). Review 59 changed copies of the record they
make; the test re-assembles these run files with the current assembler and
checks each copy against the current checker. The base URL is the local dev
server and the mode is rehearsal, so the checker refuses the record as proof.

- `county/`, `city/`, `tribal/`: each journey's run file, as the journey
  wrote it, except that each review file entry's `sha256` and `bytes` are
  re-pinned to its stand-in. The comments were typed by the journey, are
  labeled as a demonstration and represent no one.
- `*/files/*.pdf` and `*/files/*.xlsx`: stand-ins for the real review files,
  to keep the folder small. A PDF stand-in holds the real file's `pdftotext`
  pages joined by form feeds; a workbook stand-in holds the real file's
  SheetJS cells as JSON. Each sits under a two-line header naming the file
  it stands for, the format lane 53 used.

Lane 61 built this folder with `build-dress-fixture.mjs`, kept outside the
repository in the operator state folder (`lane61-tools/`).
