# Safety and portfolio browser checkpoint

The production app on port 3200 was positively identified as
`bf749316a7b62dfa00fb987e213bc675990fca51`. Local `qa:gate` passed at that
checkout: 12,881 app tests, 135 live database checks, production dependency audit
with zero vulnerabilities, and the build. The separate development-dependency
audit is not claimed clean. Remote RLS `33949244764` passed. Upgrade
`33949211278` passed the same migration bytes from v0.43.0 at `642382b8`.

## Safety, browser-confirmed

From sign-in and visible navigation, the project selector opened the damaged
historical acquisition. Its missing-record warning was visible at desktop and
390px; downloads were disabled and no zero KSI count was offered. Retrieving a
new acquisition produced 361 fatal-or-serious-injury crashes. Returning to the
unattached acquisition still showed 361. The main agent inspected all four
screenshots, including the warning and retained count at 390px. Console errors
were empty; neither mobile capture had document-level horizontal overflow.

The new acquisition `41c41262-76f4-4811-9e24-eb269a9b0a1e` retained all 4,123
stored rows. The previous intact acquisition
`eb50a548-ed67-41ab-9a94-50cba0b01bc3` still retained its own 4,123 rows.
The two older damaged acquisitions remain unchanged and unavailable.

Both downloaded artifacts name the exact new acquisition. Independent hashes:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| CSV | 195129 | `6a4a0ec29b38141f09b43db9632a78f9f7798e9b0a5bf58532522dd221b8cfbc` |
| GeoJSON | 1009123 | `06977671849cc14bc07311b6458ece7863b17c91fc1a808f4b26c5567a1e902d` |

The GeoJSON has 1,408 unique crash IDs, matching the visible filtered total.
Its bands contain 63 fatal, 298 severe-injury, 950 injury, and 97 unknown records.
These are crash counts, not casualty counts or an estimate of unreported crashes.
The map draws only 1,000 points and explicitly states the larger matching total.

Proof directory:
`~/.local/state/openplan/release-checks/v044-2026-09-05/safety-custody-browser/`.
A deliberate wrong-commit control failed before sign-in.

## Portfolio, saved correctly but export blocker found

The same identified app created three projects from the existing exercise CSV.
Amounts 4,200,000, 1,150,000, and 7,600,000 USD retained null price years and the
same stored source-document link. This was verified independently in the local
database. The Funding tab visibly displayed the first saved amount and
"Price year not entered" at desktop and 390px. The source document was explicitly
reported unreadable in that document list, not presented as absent or verified.

Recorder errors are preserved: the first recorder expected HTTP 200 where the
successful create returned 201, and the first continuation looked for the cost
on Overview rather than following the Funding tab. Neither is evidence of a
failed project creation. No duplicate import was performed during continuation.

The actual workbook download then returned 409 for costs without a price year.
This was a remaining product defect: the workbook builder and reviewed importer
already preserved blank years, but the export route retained an obsolete refusal.
The route correction removes that refusal, and the visible workbook action now
uses a native download link. The regression runs the real route, real workbook
builder, and real importer, proving the original amount/currency and null year
survive even when a default year is configured.

The updated route test failed on the original 409. A comment no-op survived;
inserting a year made the real round trip fail, and removing the download
attribute made the visible-action test fail. Both were restored. The earlier
QA pass does not cover this follow-up. A fresh build/browser download, final QA,
remote CI, and the complete twelve-job outcome gate remain required.

The old first-week run remains interrupted, not completed. No scientific default,
holdout, frozen model artifact, or acceptance rule was changed by these repairs.
