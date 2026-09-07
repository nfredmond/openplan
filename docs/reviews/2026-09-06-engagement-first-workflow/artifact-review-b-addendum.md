# Independent Engagement artifact review B, revised delivery

Reviewed September 6, 2026 Pacific. This addendum preserves the original independent review unchanged. It reviews only the six immutable files in `/home/nathaniel/.local/state/openplan/engagement-evidence/delivered-revised/`, named `stress-public` and `stress-internal` with PDF, XLSX and ZIP extensions. The implementing agent reports that both jobs were queued through the real UI and all six browser downloads succeeded. I independently inspected the files, not those browser actions or the final running build.

## Disposition

**Do not accept these ZIP files as exact portable snapshots. Both contain a corrupted Unicode character and fail their declared snapshot checksum.** The workbook also fails the no-repair readability requirement in native LibreOffice because ordinary cells do not inherit the intended wrapping/top alignment. The implementing agent has received both defects and reports fixes underway. I have not inspected corrected replacements.

The PDF revisions improve the report. All 499 PDF pages received visual layout inspection. Question denominators reconcile independently, long response pieces now retain record/part identity, and section links are visible. Workbook totals recalculate correctly in LibreOffice after deliberately wrong numeric caches are supplied. These positive results do not cancel the two remaining defects.

## Exact snapshot corruption

| Scope | Manifest snapshot SHA-256 | Extracted snapshot.json SHA-256 |
|---|---|---|
| Public | `4a2875cbe5e3039caf5676af2ce17d0e2aa3882739f3cc80a459b9c4e3e3fc45` | `da85c76be99339fca5cfb27f7bb501ef76cb73668b957186343da3242c101e12` |
| Internal | `6e8935025e0ad04646ceae73c94910861a6bf9a70fa8ba624e73af198dd0b2b1` | `c98c235676b114f5ceaaa7a2026a7d5e241f2a3000c289ed54aa975082e14355` |

The long contribution `f96a3a75-d73a-451f-bf81-f858a723508b` has one emoji replaced by two U+FFFD replacement characters in each ZIP's snapshot. Its CSV and reconstructed XLSX body have 36,037 Unicode codepoints; snapshot.json has 36,038. Public body offsets 10511 and 10512 contain U+FFFD, at snapshot UTF-8 byte offsets 604097 and 604100. Internal body offsets 5255 and 5256 contain U+FFFD, at bytes 682038 and 682041. Offsets are zero-based.

This is an observed byte/meaning defect, not an inference from file size. The PDF and XLSX bytes exactly match their corresponding ZIP members and manifest checksums. CSV, reconstructed workbook long text and reconstructed HTML narrative pieces agree exactly on every contribution body after accounting for intentional CSV formula protection. Thus successful sibling artifacts concealed the corrupted snapshot. The proposed cause, string-to-UTF-8 encoding across a surrogate boundary in ZIP creation, is the implementing agent's engineering diagnosis. A corrected delivery must independently match the retained snapshot hash after extraction.

## LibreOffice recalculation and layout

I used an isolated LibreOffice profile under `/tmp/engagement-review-b-artifacts/lo-profile`. Every numeric formula cache in a scratch copy of each original workbook was changed to `987654321`, preserving the formulas and source workbooks. LibreOffice initially reported all four wrong cached values. Calling `calculateAll()` changed the values as follows, and saving/reopening the resulting XLSX retained them:

| Scope | Contributions | Survey sessions | Answers | Staff responses |
|---|---:|---:|---:|---:|
| Public | 905 | 11 | 10 | 1 |
| Internal | 1005 | 12 | 11 | 1 |

All four formulas are Summary B2:B5 and count the ID columns of the corresponding record sheets. No other formulas occur in the originals, including formula-like participant text. The recalculated files contain no error-type cells. Every original nonblank cell value, including reconstructed long text, survives LibreOffice's round trip. Empty-string cells sometimes become absent cells; the independent comparison treats those as the same blank state and does not confuse them with nonempty data loss.

The poisoned cache is a meaningful negative control: without actual calculation, the observed result remained 987654321. This establishes LibreOffice calculation, not merely successful file opening or preservation of an already-correct cache.

Native LibreOffice PDF previews covered representative ranges of all nine worksheet types. These are inspection previews with selected print areas and scaling, not replacement deliverables. The first selection-only attempt exported the whole workbook; later print-area previews produced the intended representative views. I did not treat the unexpectedly large first conversion as successful range isolation.

The previews exposed a real workbook style failure. Directly loading the original public workbook through Calc reports `IsTextWrapped=false` and `VertJustify=3`, bottom alignment, for Read me B4/B6/B8 and Long text E2. The XML intends wrapping and top alignment in style zero, while ordinary cells omit an explicit style index. This result comes from the original file before recalculation. The recalculated Long text E2 becomes wrapped but remains bottom-aligned. Read me cells remain unwrapped.

Read me B5's snapshot hash and B7/B8/B9 guidance visibly run beyond their cell bounds in native rendering. Long text E2 contains 600 codepoints and 46 newline characters in a row only 5,962 hundredths of a millimeter high, about 169 points. A narrow native rendering of E1:E3 shows clipped text and text intruding beneath the header. Fixed row height based mainly on character count cannot accommodate that many explicit lines. This is a visual defect despite exact retained cell strings. Closure needs explicit effective wrapping/top alignment plus line-aware fragment sizes/heights, followed by original-file Calc property and visual checks. It must not require recipients to repair row sizes manually.

## Record and denominator reconciliation

The independent script reads raw OpenXML, ZIP JSON/CSV/GeoJSON and PDF text. It does not call the production report builder.

- Public records are 905 contributions, 11 sessions, 10 answers and one response. Internal records are 1,005 contributions, 12 sessions, 11 answers and one response. Every ID is unique in its own record set. Workbook and CSV ID order matches the corresponding snapshot arrays.
- Every exported workbook cell matches the snapshot, except the known corrupted long-body value in snapshot.json. Long text parts are consecutive, reconstruct exactly, and their reconstruction equals the CSV and HTML body. Definitions JSON in the workbook matches the definitions retained in the snapshot.
- The GeoJSON contains exactly the mapped snapshot records with identical geometry: public 304 features, comprising 302 Points, one LineString and one Polygon; internal 337, comprising 335 Points, one LineString and one Polygon. This fixture has no coordinate-only legacy record, so it does not close the earlier legacy normalization defect by itself.
- Public snapshot items and sessions are approved, and checked private moderation/fingerprint fields are excluded. This verifies these artifacts, not every live publication/privacy route or hypothetical sensitive field.
- PDF text contains every included contribution and answer ID. ZIP photo bytes match their recorded checksum and length. PDF/XLSX member bytes match the separate delivered files.

Question summary values were recomputed by retained configuration and question ID. The worksheet and PDF agree with the independent calculation:

| Scope and historical question | Sessions | Answered | Redacted | Unanswered or not shown | Additional identical answers |
|---|---:|---:|---:|---:|---:|
| Public, original wording | 5 | 4 | 1 | 0 | 3 |
| Public, revised wording | 5 | 4 | 0 | 1 | 3 |
| Internal, original wording | 5 | 4 | 1 | 0 | 3 |
| Internal, revised wording | 6 | 5 | 0 | 1 | 4 |

Each scope also has one session without a retained configuration, excluded from question denominators while its recorded answer remains in the register. The PDF explains this exclusion. It also explains that unanswered includes questions not shown by branching and answers outside filters, and that repeated means additional identical answers retained as separate records. Those labels prevent interpreting repeated content as a count of duplicate residents or unanswered as refusal. The fixture contains one question across two versions. It does not prove every possible question type, branching combination or filter interaction.

## PDF visual coverage

I independently rendered and viewed public pages 1–241 and internal pages 1–258 on 22 contact sheets. I then inspected readable 120-dpi enlargements of public pages 1, 2, 150, 233 and 241, and internal pages 2, 74, 255 and 258. Public pages 175 and 176 were also individually opened to resolve a contact-sheet ambiguity. The supplied long-text fixture is artificial and explicitly labeled as such.

No gross clipping, overlapping body blocks, missing-page pattern or unusable script glyphs was apparent in the revised report PDFs. The public and internal question tables are legible and reconciled. The image and its contribution identity are visible together on internal page 74. Old/revised question meanings and the synthetic response remain identifiable. The long body now has all 167 ordered part labels, spanning public pages 150–233 and internal pages 167–250. Continuation pieces repeat the record UUID, addressing the specific identification defect in the first review. Section navigation links are visible on page 1; actual interactive activation was not independently exercised.

This is full page coverage at contact-sheet scale plus targeted readable enlargements. It is not a claim that every line of 499 pages was read at full size, that a native speaker approved every language, or that tagged PDF reading order passed a screen reader. A practicing recipient's usefulness test and an optional concise report/separate appendix remain separate product evidence.

## Source file identity

| File | SHA-256 |
|---|---|
| stress-public.pdf | `abb7768cc5ca62d544a043fd9f74aa44b1f20a255b09d595c7d757a9c99729c0` |
| stress-public.xlsx | `558f0642a2db646085c787852521226f33e06ef54d72b8402779414d317c1db7` |
| stress-public.zip | `559b572295f3469dd401e4e82ab7a31c04da4fffd962a4576b6f06721e86f417` |
| stress-internal.pdf | `65d510a3a6e510d30c6940e4d4cf2684d27e00648171c598f13893041bf6c3e8` |
| stress-internal.xlsx | `2087813f6c69c10d6a7c6373fac91cc90e404f97042f305ad1af14853d64af8c` |
| stress-internal.zip | `1ddc7f8a0a1304f0d1e48f77422c5c89b80c4c1f6814e0796605770a2b869044` |

All six source checksums remained unchanged at the end of inspection. Evidence scripts, raw reconciliation results, poisoned/recalculated copies, native Calc properties and rendered previews are under `/tmp/engagement-review-b-artifacts/`. Only this addendum and that scratch directory were written. The private LibreOffice processes started for inspection exited; no source/server/shared-profile changes were made.

The original review's human usefulness, competitive superiority, full restricted-history portability, accessibility and nationwide/scientific boundaries remain unchanged. A final corrected export needs its own artifact identity and focused reinspection; this report does not retroactively accept a later file bearing the same display name.

## Subsequent style-candidate inspection

The implementing agent subsequently requested inspection of `style-candidate-public.xlsx` and `style-candidate-internal.xlsx` in the same evidence root. These were generated from the retained database snapshots, according to that agent, and are **not browser-delivered replacements** for the files rejected above.

Both candidates correct the observed effective Calc style. Direct native loading reports `IsTextWrapped=true` and `VertJustify=1`, top alignment, for Read me B5/B7/B8/B9 and Long text E2/E3. Native print previews show the complete snapshot hash and guidance, and the first four long-text pieces without clipping or overlap. The first two long-text cells now contain 168 and 132 codepoints with 10 and 11 newlines, respectively. The body has 273 consecutive pieces. Independent reconstruction of all three long fields, the body and two definitions, exactly matches the prior intact workbook values.

Candidate checksums are public `12f6eb9a0093a332f9ef8cb39c5c80e301f4d6dc0ff099d602f817d0800dbc5b` and internal `31875324e407c41d8385aa86bab8e8cfd721e81737c6101ed90408d96536c163`. Evidence is in `candidate-cell-properties.json`, `candidate-reconciliation.json` and four native candidate preview PDFs/PNGs in my scratch directory.

This closes the specific style/chunk-layout defect at candidate level. It does not replace the final delivery, snapshot checksum, calculation and file-identity checks required on the browser-delivered corrected artifacts. The earlier failing originals and their findings remain unchanged.
