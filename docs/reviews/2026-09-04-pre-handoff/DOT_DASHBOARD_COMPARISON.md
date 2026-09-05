# DOT Dashboard and OpenPlan: background comparison

September 4, 2026 Pacific. Nathaniel asked about his former employer Green DOT Transportation Solutions' legacy DOT Dashboard, with eventual functional coverage but no immediate priority change. Public evidence is sufficient to identify useful workflow benchmarks. It cannot establish every version/customer customization or prove that OpenPlan already matches them. His subsequent OWP priority and palette request are separately recorded below.

## What I found

Green DOT's current public [program-management page](https://greendottransportation.com/service/program-management/) describes DOT Dashboard as an agency-tailored web interface using existing databases, with project programming, deadlines, organized records, stakeholder coordination and invoices/claims linked to funding types. This is a vendor description, not independent operational verification. Continued public advertising does not establish current deployment or support quality.

The page links an actual [product screenshot](https://greendottransportation.com/wp-content/uploads/2022/03/Screenshot-2024-12-04-164441.png), which I downloaded and visually inspected. It shows agency/project selection; project identity, jurisdiction, treatment and entered completion percentage; planned/completed physical quantities; map and photographs; funding by year/phase; and a drawdown/remaining-budget section. The screenshot's lower budget section is cut off. Visible length fields do not establish their units or calculation method. A banner mentions user manual version 2, but a public manual was not located in this bounded search. The filename contains a 2024 date; it is not proof of the currently running version.

The [agency evidence report](DOT_DASHBOARD_AGENCY_EVIDENCE.md) adds three dated cases. Lake APC proposed OWP administration in 2019. NVTA's June 2025 staff report describes operational project/period-reporting foundations and a later proposed Measure U transition. Del Norte's January 2024 packet proposes upgrades to community mapping and comment reporting. The report distinguishes these evidence levels and identifies selected pages; none of the actual applications was tested. Root independently read the relevant NVTA staff narrative and selected amendment passages through web extraction.

## Comparison with OpenPlan

The rows below are an engineering assessment using the existing review and bounded current-source searches at dd7b4f4d. They do not promote an OpenPlan workflow to complete.

| Workflow to retain | OpenPlan foundation | Remaining proof and roadmap home |
|---|---|---|
| One project record with map, images, documents, responsible agency and progress | Projects, GIS, Documents and delivery controls | Complete visible job and useful recipient record; M2/M5/M10. A percent-complete field is not evidence of accepted work. |
| Fund/year/phase budgets, invoices, claims and remaining balance | Funding, Programs and Invoicing records | Reconcile cost, billing, cash and funder claim without duplication; M11/M13. Earlier review found financial-basis and retrieval gaps. |
| Planned and completed physical outputs | Project/delivery and local-measure foundations | Preserve quantities, units, period and source evidence through municipal reporting; M10/M13. Screenshot resemblance cannot close this. |
| Annual OWP work elements, funding, progress and claims | Generic work plans, project budgets, Programs and reporting | Named complete OWP cycle was under-specified. Nathaniel now independently makes it high priority; CORE-OWP-01/M2d own completion. |
| Mapped input, categories, staff response and reports | Engagement maps, categories, moderation and report/export foundations | CORE-ENG-02–04/M9 already require tailored setup, response dashboard, human review and PDF/XLSX artifacts. |
| Agency-tailored period reporting and portable records | Programs/local measures, document and report services | Two jurisdictions and the administrator complete a corrected reporting cycle and transfer the full record; M13/M4. |

Relevant prior source reviews are [planning contract budgets](CONTRACT_BUDGET_CORE_REQUIREMENTS_REVIEW.md), [local measures](LOCAL_MEASURE_CODE_REVIEW.md) and [engagement](ENGAGEMENT_PRIORITY_RESEARCH.md). Current read-only searches also located project deadline controls and separate proposed/withheld retention records. A search across application source, migrations and product documents found no OWP/UPWP or expanded-name matches; absence of those words is not proof that no reusable functionality exists. Budget source types still combine billed and direct-spend totals in an actuals field, which is why the existing M11 repair remains relevant.

My inference is that the strongest benchmark is a small agency finishing its recurring administrative work without juggling spreadsheets. OpenPlan's broader module inventory cannot substitute for that outcome. Retain the discovered functions as practical acceptance cases; do not copy a proprietary codebase or claim full parity without access and observed tasks. Source licensing, APIs, complete export schemas, performance, accessibility and actual moderation remain unknown. No contact, credentials, paid access or private former-employer files were used.

## Priority and small appearance request

The DOT Dashboard comparison stays background research. OWP administration is now a separate explicit high-priority user requirement. It must not stay low priority merely because this comparison helped bring it up.

Nathaniel also requests an additional upper-right palette option using yellow, two grays and black, preserving all existing choices and avoiding the DOT Dashboard name. Proposed label: **Signal**. Use a bright yellow near `#FFCC00`, light gray near `#F5F5F5`, dark gray near `#525353` and black/near-black ink, adjusted to readable light/dark variants. These are visual starting points from the public screenshot, not a claimed official color specification.

Root read the current palette registry and ThemeControls component. Five existing choices are Cartographic, Slate, Harbor, Meadow and Plum; the default is Cartographic. Add Signal to the existing registry and both mode-specific CSS token blocks, preserve all existing IDs/default/saved choices, and keep semantic success/warning/error colors unchanged. Verify black text on yellow controls, links/focus/hover states, charts/map legibility and actual desktop/390px keyboard selection. This is a planned additive visual change, not implemented during the developer's acceptance work.

## Preservation and limits

Public source URL/retrieval/hash metadata is in [vendor metadata](dot-dashboard-source/vendor/source-manifest.json) and the agency report's source/reading ledgers. Original public PDFs/HTML/screenshot remain in isolated scratch, not copied into Git. Root read the vendor page and image, sampled its adjacent corporate pages without attributing all consulting services to the software, and searched for the product/manual. Unrelated DOT dashboards and business-directory leads were excluded. No comprehensive archive search or live parity test was performed.
