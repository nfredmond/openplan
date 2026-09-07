# Independent legacy Engagement handoff artifact review

Reviewer B, 2026-09-07 UTC (local workflow began September 6). Read-only follow-up; earlier reports remain unchanged.

The delivered ordinary handoff PDF opens and is readable across all eight pages. The project evidence ZIP passes all 23 independent integrity checks, and its embedded PDF is byte-identical to the separately downloaded PDF. No artifact-integrity blocker was found in these two files.

The parent reports that both downloads succeeded in a fresh Chrome instance with default settings during the isolated identified workflow. The earlier `ERR_BLOCKED_BY_CLIENT` was not reproduced there. I independently verified the resulting files, not the browser actions. This does not establish that the original browser profile was fixed or identify its failure's cause.

Inputs:

| File | Bytes | SHA-256 |
|---|---:|---|
| `/home/nathaniel/.local/state/openplan/engagement-evidence/legacy-delivered.pdf` | 306,566 | `bc12969b664b370bf0f6b3413be8414bdc974ef1ef2b3c2c51fa4370476bf9b9` |
| `/home/nathaniel/.local/state/openplan/engagement-evidence/legacy-delivered.zip` | 196,249 | `c3fa35c89686b5e98db7c84dfe413ece48c40255a4caa227baf47327e6144ee5` |

The PDF title is “Complete streets demonstration Engagement Handoff Packet.” It has eight letter-size pages, created September 7 at 06:33:32 UTC. I rendered and viewed every page individually at 1,400 pixels on the longest edge, and extracted text with Poppler. Page 1 states the synthetic demonstration context, zero approved/categorized items ready for review, three uncategorized items, absent project geometry and unrecorded project cost. Pages 2–4 show evidence counts, explicit unassessed jurisdiction claims and governance state. Page 5 lists absent project records. Page 6 gives project/funding context. Pages 7–8 give the campaign handoff snapshot, source mix and provenance.

I found no omitted-looking text, overlapping text or unreadable characters at this resolution. Cards break across pages 2–3, 3–4, 6–7 and 7–8; for example, page 6 ends with a reimbursement heading whose value follows on page 7. The report-origin block is duplicated on pages 7 and 8. These are presentation weaknesses, not observed data loss.

This legacy packet is mostly project-status/readiness context. It truthfully says zero of three items are ready for handoff, all three are uncategorized, two are geolocated (67%), and no approved/categorized item content is available. It is not a substitute for the separate detailed review PDF/XLSX/ZIP with contribution text and survey denominators. The fixture does not establish a useful content-rich legacy packet after categorization. No human reader assessment, screen-reader test, link-target test or native-language review was performed.

The archive uses `project_evidence_manifest.v2`, bundle `7ddca6b2-e31f-4ce5-b3f3-10598d69cc44`, project `77e19961-7edd-40a1-9abe-417913663adf`. Its eight checksum-list entries cover every nondirectory member except the checksum list itself. All eight SHA-256 values match. Each of the six included evidence entries matches its manifest byte size and SHA-256, and these entries cover every evidence payload. The HTML report is explicitly excluded because it was not selected. Included payloads are the report PDF, project record, GeoPackage, jurisdiction readiness, linked-data provenance and modeling evidence. The manifest and README are also checksummed. The current-report pointer references the same PDF record and checksum as the embedded file.

The GeoPackage passes SQLite integrity checking. Its layer-status table records eight expected layers; seven are unavailable with reasons, and engagement geometry is included with two records. The actual engagement table has two rows. It contains geometry, item identity, source type, time and moderation status; it has no comment-text or participant-name columns. Empty geometry tables remain accompanied by availability status rather than being presented as measured zero. No QGIS/OGC spatial-conformance test or independent database-to-geometry comparison was performed. The synthetic-project caveat is present in the project record and PDF; the layer metadata's generic `observed_screening` label must not be read as real public opinion from this demonstration.

The archive explicitly states that it is a retained evidence snapshot, not a backup, approval, adoption or publication. No linked plan was selected; the manifest states that it cannot be submitted for governed approval. I retain those boundaries.

The checker was challenged without changing originals: harmless dictionary reordering leaves checksum checks passing; appending a harmless PDF comment in scratch memory changes its bytes and is rejected by both the checksum-list and current-PDF hash comparisons. This establishes sensitivity to member-byte alteration, not exhaustive mutation coverage.

Evidence is retained under `/tmp/engagement-review-b-artifacts/legacy/`: `check.py`, `checks.json`, `pdf.txt`, `page-1.png` through `page-8.png`, and a scratch extracted GeoPackage. No source, server, database, worker or browser changes were made. Both original input hashes were checked again at completion.
