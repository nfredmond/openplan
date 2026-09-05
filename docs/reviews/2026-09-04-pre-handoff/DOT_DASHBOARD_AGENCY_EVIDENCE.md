# DOT Dashboard: evidence from public agency records

September 4, 2026, Pacific time. Bounded background research for OpenPlan's eventual functional coverage, at the user's stated low priority. Three agency cases were reviewed. This report does not assess current vendor software, establish feature parity, or recommend displacing higher-priority work. No account, application, browser session or agency contact was used.

## Source inventory and coverage

| Record | Actual reading and evidentiary status |
|---|---|
| [Lake APC TAC packet, September 19, 2019](https://www.lakeapc.org/wp-content/uploads/2019/09/Lake-TAC-Packet-9-19-19.pdf) | 33 PDF pages. Read agenda identification and PDF pp.8–9: dashboard memo and OWP amendment staff report. Proposed development, not acceptance evidence. Other packet contents not fully reviewed. |
| [NVTA board packet, June 18, 2025](https://nvta.ca.gov/wp-content/uploads/2025/06/NVTA-Agenda-Packet-06-18-25.pdf) | 92 PDF pages. Read item 10.2 staff narrative, proposed amendment and task scope, pp.32–40; sampled O&M letter p.43. Visually checked p.38. Staff reports existing use; later enhancements remain proposed. No subsequent execution or acceptance record reviewed. |
| [Del Norte LTC TAC packet, January 30, 2024](https://static1.squarespace.com/static/57f8232ce58c6208092f73fa/t/65b80824705ceb4c6df7186d/1706559524905/TAC%2BPacket%2B013024.pdf) | 13 PDF pages. Read agenda and pp.5–8, including South Beach Climate Resilience Plan amendment and outreach scope. Proposed changes, not demonstrated functionality. Official provenance confirmed through the [agency meeting index](https://www.dnltc.org/dnltcmeetings); its January 30 link redirects to this Squarespace document. |

The official Del Norte redirect produced a web-tool retrieval error, but the equivalent encoded CDN URL and direct public PDF retrieval succeeded. This is a retrieval limitation, not a missing agency record. PDFs, hashes and retrieval timestamps are in [source-manifest.json](dot-dashboard-source/agency/source-manifest.json). Only relevant sections were inspected; no full-packet reading is claimed.

## Dated feature matrix

“Reported existing” below means agency staff described use at that date. It does not mean independently tested or necessarily unchanged today. “Proposed” identifies a desired contractual outcome, without assuming approval or delivery.

| Function | Agency evidence | Status |
|---|---|---|
| Annual OWP administration | Lake proposed a public OWP and administrative portal, building on an existing construction/STIP database. | Proposed, 2019; pp.8–9 |
| OWP funds and claims | RPA/PPM/grant/LTF management, claims, state invoices and payment retention. | Proposed, Lake p.8 |
| Work-element delivery | Schedules, percentage-complete graphics, document library and automated reporting. | Proposed, Lake p.8 |
| Jurisdiction project records | Logins, project status/costs, photos, signage and closeout documents. | Reported existing, NVTA p.33 |
| Period and public reporting | Semiannual reporting, presentation summaries, document library, intake/completion forms and user manual. | Reported existing, NVTA p.33 |
| Tax-measure administration refinements | Jurisdiction-scoped funds, persistent report filters, signage exceptions, report-dated documents and equivalent-fund prompts. | Proposed Phase 3, NVTA pp.37–40 |
| Mapped engagement | Embedded map/survey, project-linked comments, category/search/sort controls and report-to-map navigation. | Proposed upgrades, Del Norte pp.7–8 |
| Engagement analysis and response | Category charts, report exports and combined online/in-person comment matrix; Green DOT compiles, GHD responds. | Proposed scope/role split, Del Norte p.8 |

Sources for each row are the three linked packets above; page citations distinguish the exact evidence rather than assigning a present capability to the entire product.

Lake's staff report describes spreadsheet complexity, multiple funding years and repetitive entry as the practical problem. Preliminary reconstruction had begun; the packet requested an OWP amendment recommendation. It does not establish that the proposed portal subsequently replaced spreadsheets. [Lake pp.8–9](https://www.lakeapc.org/wp-content/uploads/2019/09/Lake-TAC-Packet-9-19-19.pdf).

NVTA distinguishes existing operation from a new scope. Its staff describes prior migration and implementation, while the attached Phase 3 schedule anticipates later completion. The O&M extension is also proposed. Neither the passage of the proposed completion date nor an agenda attachment proves delivery. [NVTA pp.32–40, 43](https://nvta.ca.gov/wp-content/uploads/2025/06/NVTA-Agenda-Packet-06-18-25.pdf).

Del Norte's current public homepage links a Green DOT comments map and invites location-specific feedback. That establishes a public entry-point reference, not successful submission, moderation or the 2024 enhancements' completion. The map application was not opened. [DNLTC homepage](https://www.dnltc.org/).

## Useful eventual acceptance cases

The following are recommendations for OpenPlan evaluation, not additional claims about DOT Dashboard. Root owns the current implementation-to-roadmap mapping.

1. **Finish an OWP reporting period.** Start with an adopted work program, prior balances and source records. Record staff/consultant progress, allocate eligible costs to work elements and funds, prepare a claim, resolve a correction and preserve the submitted version. Reconcile the report against the underlying ledger. A polished summary that omits carryover or double-counts one invoice must fail acceptance.
2. **Complete recipient-to-administrator reporting.** Have two jurisdictions report to one administering agency. Exercise different available funds, a late correction, a justified evidence exception and a document tied to an earlier reporting period. Verify authority on direct access as well as screens. A shared selection list is not proof of permission isolation; a saved form is not proof of receipt or approval.
3. **Carry engagement into a planning decision.** Combine mapped and meeting comments, inspect geography, categorize with traceable edits, assign responses and export a reviewable matrix. Preserve disagreement, missing location and unresolved comments. Category percentages must state their denominator and must not masquerade as population opinion.
4. **Hand the agency its records.** Export a usable packet and structured data with stable project, fund, period and document relationships. Demonstrate that another authorized staff member can understand the record without the original consultant. Retain historical rules and reports when a successor funding program starts; changing a display label must not rewrite prior obligations.

These cases emphasize complete planning work. They do not justify copying an unavailable interface or making a blanket “better than DOT Dashboard” claim. A later comparison would need a representative task set, access authorization, comparable inputs and observed human outcomes. Until then, these records support requirements discovery only.

## Unknowns and stopping point

No authenticated feature, runtime behavior, actual product screenshot, API, data export schema, accessibility conformance, moderation control, recovery process or security boundary was tested. The inspected page image was contractual text, not a software screen. Current pricing, support performance, source licensing and statewide adoption were not established. The agency reports do not answer whether every customer receives the same customized functions.

A future access opportunity could settle usability and operational behavior; accepted deliverables or subsequent agency records could settle proposed-feature delivery. Neither is needed to retain this small benchmark now. No further search, contact or implementation is recommended for this low-priority reconnaissance.

The active checkout was not edited. Its observed status changed independently during concurrent work; final HEAD/status and exact reading limits are recorded in [reading-coverage.json](dot-dashboard-source/agency/reading-coverage.json). Only this report and its owned source directory were written.
