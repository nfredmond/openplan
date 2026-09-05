# LAPM source currency and full-chapter reading coverage

Reviewed September 4, 2026 Pacific / September 5 UTC. This is a product and engineering feature-gap review, not a certification of a project or an independent legal opinion. The active development checkout remained read-only. Repository comparisons identify e6900750 and their bounded source paths; developer-owned safety changes appeared during this review and were not altered or tested.

## What “entire manual” means here

The review team read all **492 pages** of the latest annual manual linked by Caltrans: 490 pages across 19 substantive chapters, plus the combined PDF's cover and contents. Chapter 19 is reserved. Reading was divided among four reviewers; this is not a claim that one reviewer independently read every page four times. Each reader tracked actual page reading, revisited truncated extracts, and visually inspected selected diagrams, tables and bulletin redlines where text extraction could misrepresent meaning.

The [official manual index](https://dot.ca.gov/programs/local-assistance/guidelines-and-procedures/local-assistance-procedures-manual-lapm) links the [2026 combined manual](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/lapm-2026.pdf). Its SHA-256 is `994c07d440f4a55ce2b4297f63bf1db04cc2e60ef67ef0731eca940778dc532f`. Individual chapter extracts were compared to their corresponding combined-PDF pages. The only identified normalized-text differences were contents-page spacing in Chapter 10 PDF page 2 and Chapter 12 PDF page 1; no substantive chapter-text divergence was found. This comparison is not a full pixel comparison.

| Chapter | Subject | PDF pages read | Detailed review |
|---|---|---:|---|
| 1 | Introduction and Overview | 4 | [1–5, 18, 20](LAPM_CHAPTERS_01_05_18_20_REVIEW.md) |
| 2 | Roles and Responsibilities | 16 | Same report |
| 3 | Project Authorization | 24 | Same report |
| 4 | Agreements | 5 | Same report |
| 5 | Invoicing | 17 | Same report |
| 6 | Environmental Procedures | 76 | [6–8, 17](LAPM_CHAPTERS_06_08_17_REVIEW.md) |
| 7 | Field Review | 9 | Same report |
| 8 | Public Hearings | 8 | Same report |
| 9 | Civil Rights and Disadvantaged Business Enterprises | 44 | [9–12](LAPM_CHAPTERS_09_12_REVIEW.md) |
| 10 | Consultant Selection | 70 | Same report |
| 11 | Design Guidance | 11 | Same report |
| 12 | Plans, Specifications & Estimate | 44 | Same report |
| 13 | Right of Way | 47 | [13–16](LAPM_CHAPTERS_13_16_REVIEW.md) |
| 14 | Utility Relocations | 13 | Same report |
| 15 | Advertise and Award Project | 13 | Same report |
| 16 | Administer Construction Contracts | 67 | Same report |
| 17 | Project Completion | 6 | [6–8, 17](LAPM_CHAPTERS_06_08_17_REVIEW.md) |
| 18 | Maintenance | 8 | [1–5, 18, 20](LAPM_CHAPTERS_01_05_18_20_REVIEW.md) |
| 19 | Reserved | — | No substantive chapter to read |
| 20 | Audits & Corrective Actions | 8 | [1–5, 18, 20](LAPM_CHAPTERS_01_05_18_20_REVIEW.md) |
| Combined front matter | Cover and contents | 2 | Root reviewer |
| **Total** | | **492** | |

Source downloads and reading are deliberately separate records. [Source manifest](LAPM_SOURCE_MANIFEST.json) records URLs, retrieval times, byte counts and hashes. [Reading coverage](LAPM_READING_COVERAGE.json) records actual read pages and selected visual coverage. Public source PDFs, original extracts and rendered figures remain in isolated review scratch; they were not modified or added to the repository. The source links and hashes permit later retrieval and detect revisions.

## What supersedes January 2026 text

The [current office-bulletin index](https://dot.ca.gov/programs/local-assistance/guidelines-and-procedures/division-of-local-assistance-office-bulletins-dla-obs) says bulletins can supersede manuals and exhibits. All four current bulletin texts were read in full (28 pages). The [LPP index](https://dot.ca.gov/programs/local-assistance/guidelines-and-procedures/local-programs-procedures-lpp) was checked for incorporation/supersession; its latest listed annual LPP being 25-01 does not negate the separately posted 2026 manual.

| Bulletin | Issued / timing | Meaning for OpenPlan |
|---|---|---|
| [26-01-R1](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/ob/2026/ob26-01r1.pdf), 2 pages | February 2026; immediate | Revised federal NEPA analysis instructions and named environmental forms. Do not apply the change as deletion of CEQA, Title VI, ADA or every equity workflow. |
| [26-02](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/ob/2026/ob26-02.pdf), 5 pages | August 2026; October 1 transition | Revised bidder/proposer data collection, Exhibit 9-L and submission timing. Retain advertisement/solicitation date, selection method, quote-provider coverage and exact instructions. |
| [26-03](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/ob/2026/ob26-03.pdf), 14 pages | August 2026; effective issuance; supersedes 25-07-R3 | DBE interim rule changes suspend specified goal, credit, good-faith and reporting requirements/forms; other civil-rights and prompt-payment duties continue. Old records remain historically valid artifacts. |
| [26-04](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/ob/2026/ob26-04.pdf), 7 pages | September 2026; Phase 2 effective October 1 | Manufactured-product Buy America implementation depends on the specified authorization/contract timing and product category; build a dated transition, not a universal present-day checkbox. |

The manual index links `ob26-02-old.pdf`, while the current bulletin index links `ob26-02.pdf`. Both were preserved. Their bytes differ; their full extracted text matches. A limited root visual comparison found no operative difference on the inspected page. This does not prove pixel equivalence. Prefer the current bulletin index URL and preserve provenance.

Redlines matter: the old “50 percent or more” iron/steel paragraph in 26-04 is struck out. The inserted wording is “more than 50 percent”; treating both as simultaneously operative creates a false contradiction. Likewise a residual conditional DBE sentence in 26-02 does not revive requirements expressly suspended by 26-03. Detailed overlays and limitations are in the chapters 9–12 review.

## Linked exhibits and external authorities: explicit boundary

The [official forms index](https://dot.ca.gov/programs/local-assistance/forms/local-assistance-procedures-manual-forms) was inventoried, including revision dates and inactive entries. A title-based inventory found 133 form-labelled links; this is not a claim to have read 133 forms, nor proof that all format variants were enumerated.

Exhibit 9-L was separately read in full (four pages). Standard 6-A, 6-B, 6-J and 6-K were downloaded and their identities captured; download alone is not full reading. The separately indexed May 2026 pilot PES 6-A is an XFA PDF that rendered/extracted only an Adobe Reader requirement page in this environment. Its actual form content was not readable here. Preserve pilot status and an external-form workflow; do not silently adopt it or claim an HTML conversion is the official form.

This assignment completed the annual manual's full chapter reading. It did **not** independently read every incorporated federal/state law, every linked exhibit, the entire LAPG, Standard Environmental Reference, Right of Way Manual, Construction Manual, bridge manuals, agreement or program guideline. January references potentially affected by later law—including Chapter 16's EO 11246 text—remain implementation-time authority questions. Actual current forms and controlling agreements need specialist review for each claimed workflow.

## Source conflicts that need a recorded resolution

These are observed tensions, not permission for software to select a convenient rule:

- Chapter 20 §20.2 printed page 2 says five business days for a draft audit response; Figure 20-1 printed page 3 says ten. Retain the engagement letter and documented auditor/DLAE clarification.
- Chapter 8 printed pages 5–6 describe the post-hearing period as at least ten days versus no later than ten days, with longer periods for complex cases. Preserve reviewed notice/deadline decisions and all received comments.
- Chapter 13 §13.12.2 printed page 36 has conflicting goodwill/interest eligibility language. Preserve disputed eligibility and obtain the applicable authoritative resolution before a claim.
- Chapter 6's broad NHS field-review wording must be read with Chapter 7's specific project categories and DLAE determination. A field-review form and an actual meeting are distinct requirements.
- Chapter 15's NHS-specific bid-analysis requirement must not be erased by its later general statement that bid analysis is not required.
- Chapter 5's “more than” versus Chapter 20's “or more” single-audit threshold wording is resolved by selected current [FAC guidance](https://support.fac.gov/hc/en-us/articles/18792372809101-Is-my-organization-required-to-conduct-a-Single-Audit): inclusive $750,000 for fiscal years beginning before October 1, 2024, inclusive $1 million for fiscal years beginning on/after that date. Actual entity expenditures and other applicability still require review. Different CAP pathways also have different typical response periods; they are not a single deadline.

The practical feature requirement is an attributed applicability decision, source version, effective trigger, uncertainty and written resolution. A generic “Caltrans compliant” badge cannot supply these facts.
