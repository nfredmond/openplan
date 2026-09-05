# Historical scope omissions in the renewed roadmap

Review date: 2026-09-04 Pacific / 2026-09-05 UTC. This is a bounded omission audit of historical OpenPlan user requirements against renewed `ROADMAP_DRAFT.md` and `CORE_REQUIREMENTS_LEDGER.md`, not a claim to have recovered every prior conversation or tested current product behavior.

## Finding

**Yes: the renewed documents still omitted explicit outcomes that Nathaniel had already requested.** The clearest is complete aerial/drone work. Several others appear only under broad platform/GIS/analysis labels, without enough definition to prevent their detailed outcomes disappearing again. Existing implementation may already satisfy parts; this audit identifies missing traceability, not necessarily missing software.

The snapshots checked at 2026-09-05T00:07:38Z were roadmap SHA-256 `6eacff25d093c6bea6322e10f40926b7226b8dfad642344001dde0950840e669` and ledger `76457954920f29289e96085c2ad21c8372ffb1755cef1178ec258f366f3a27fa`. Parent edits after these findings may repair the omissions; retain this as a dated diagnosis, not an assertion that later drafts remain deficient.

## Requirements requiring explicit restoration or stronger mapping

### 1. Aerial operations from mission to reusable products — missing explicit scope

Claude session `1c269150-b74e-49e8-9414-b9e3a95fcaa6`, `2026-08-11T01:03:55.259Z`, line 7, Nathaniel requested:

> an easy-to-use drone platform that integrates into projects/grants/overall org/agency

and:

> turn them into planning level photogrametry, point clouds

At `2026-08-11T01:17:37.219Z`, line 152, the structured question offered staged versus full aerial scope. His answer was **“Full lane including ODM in-house”**. The selected option explicitly included mission creation/downloads, real survey planning and DJI-usable export, plus imagery upload, the in-house ODM worker and ortho display. Those descriptions are the agent-authored options he selected, not independently authored user wording.

[Original request](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:7), [selected full option](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:152).

The checked roadmap has no aerial/drone milestone or explicit completion case; the umbrella platform ledger does not name aerial work. **Restore within M5a and the existing Aerial/Projects/Documents homes**, not a separate drone platform. Exit evidence should follow a permitted mission through plan/export, actual imagery intake, interruption/recovery, ODM processing, ortho/point-cloud inspection, source/accuracy limitations, reusable downloads and project evidence linkage. Distinguish planned flight from flown mission and planning-grade products from survey certification. Do not claim “better than ODM” based on wrapper features alone.

### 2. A project and workspace file library — umbrella-covered, concrete outcome absent

Same session, `2026-08-11T02:14:22.684Z`, line 363:

> Projects need their own document library if they don't already have them, and a place where the user can see all documents from all projects (filtering, etc.).

At `02:16:15.174Z`, line 368, he adds all files used/created by aerial operations; at `02:16:40.248Z`, line 373, **“And any reports created, anything else?”** [Project/library request](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:363), [aerial files](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:368), [generated reports](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:373).

M2/M4/M5 reference Documents and evidence but do not explicitly guarantee the unified discoverable file collection. **Map to M2a/b, Documents and existing project links.** Prove finding, filtering, opening, downloading and reusing original and generated files from both project and organization views without duplication or access leakage.

Preserve two actual choices at `2026-08-11T15:37:52.327Z`, line 1095: library **“Files-only (Recommended)”** and resident photos **“Exclude for now (Recommended)”**. The first distinguishes file custody from Data Hub reference records; the second was an interim privacy boundary, not a permanent refusal to support resident media. Any changed scope needs a safe moderation/access design. [Decisions](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:1095).

### 3. Legacy GIS/tables and general-document OCR — umbrella-covered

Same session:

- `2026-08-11T01:54:32.451Z`, line 241: **“can planners upload their own GIS layers/shapefiles anywhere?”**
- `01:56:32.300Z`, line 263: **“can the knowledge base OCR old PDFs that are uploaded?”**
- `01:57:08.979Z`, line 274: **“and both .csv and .xls and .xlsx?”**
- `01:58:13.622Z`, line 290: **“we'll also want .kmz/.kml along with geodatabases and shapefiles”**, with explicit legacy-department motivation.

[GIS](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:241), [OCR](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:263), [tables](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:274), [legacy formats](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:290).

M5 broadly protects GIS/reuse, while M12 names OCR for old RTPs. **Add a named format/outcome matrix to M5 and general OCR to M2/Documents**: actual modern/legacy fixtures, original-byte retention, geometry/CRS/attributes and workbook review, visible layer rendering, scanned pages with machine-read disclosure, recoverable conversion and export. Unsupported flavors need a precise conversion path; “geodatabase” is not one uniform format.

### 4. Breadth of work-plan templates — absent concrete coverage/done criterion

Same session, `2026-08-11T17:14:27.203Z`, line 1187, user answer:

> Exhaustive list of all types of transportation planning projects, plans, and programs, as well as as exhaustive list of land use planning projects, plans, and programs. Many templates.

[Source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:1187).

The renewed draft mentions existing templates without assigning this breadth an assessable outcome. **Map to M2a/b and the existing work-plan registry**. Maintain a practice-category matrix, identify gaps, and prove an appropriate starting work plan becomes real editable tasks/deliverables/dates. Preserve source/version and distinguish professional starting practice from statutory requirements. A current template count does not establish exhaustive coverage. Practitioner review is necessary; do not reduce the request to two examples or invent jurisdiction-specific obligations.

### 5. Grant discovery/application assistance — only indirect coverage

Same original August 11 request at line 7 explicitly calls for:

> grant application help with AI and auto search and calendaring/alerts/etc.

[Source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:7).

M13 now names post-award administration; M14 names procurement discovery. Neither explicitly closes grant opportunity discovery, preparation and deadlines. **Give Grants/Pursuits its own traced increment within existing milestones**, using shared official-source discovery and My Work components. Prove source coverage/freshness, relevant opportunity, actual requirements, bounded grounded drafting, complete prepared package, deadline alerts and truthful delivery/award handoff. Automated search must not imply comprehensive nationwide discovery.

### 6. User-selected dashboard and concrete map-first interaction — umbrella-covered

Same session, `2026-08-13T07:03:41.089Z`, line 3442, user answers a set of UX questions:

> Can the user somehow chose what's shown? Or is that too complicated?

and:

> I guess I'm just trying to say make it much more ELI5

He also says **“BIG PUBLIC FULL SCREEN MAP FIRST.”** [Source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:3442).

The message endorses proposed map-first, guided-create, reading and worklist layouts, but the detailed preceding prose is agent-authored context. The checked roadmap broadly requires usability and mapped engagement without explicit selectable dashboard content or those interaction outcomes. **Map to M2/Overview/My Work and M5/M9 map workbenches**. Prove useful saved view choices, understandable copy, visible imported layers and complete public context without sacrificing accessibility. Do not preserve a specific old layout mechanically if real observation shows it fails the intended work.

### 7. Safety and transit depth — present broad milestones, details only umbrella-covered

Safety: `2026-08-11T02:03:18.326Z`, session `1c269150...`, line 319:

> colissions on maps and all the info associated with them and able to filter. Just like berkeley's tims.

[Source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:319). M6 includes safety decisions/source coverage but should retain field-rich mapped exploration and filters as an explicit outcome; this is not a new claim of TIMS parity.

Transit: session `c82ba255-2e66-4e76-81e5-07b42c3dd8ef`, `2026-08-06T00:30:27.886Z`, line 118, user selects **“Map + corridor analysis, Feed the travel model, Service equity / Title VI, RTP transit element”**, **“Service levels, not timetable (Recommended)”**, and all three intake modes: area catalog search, operator URL and ZIP upload. [Source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/c82ba255-2e66-4e76-81e5-07b42c3dd8ef.jsonl:118).

Session `a23e6aa6-370f-435a-bdb6-5aa077dc664f`, `2026-08-07T04:25:02.343Z`, line 576, selects **“Service-level equity comparison”** first and policy fields for minority/low-income definitions, disparate-impact/disproportionate-burden thresholds, service standards and adoption provenance. [Source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/a23e6aa6-370f-435a-bdb6-5aa077dc664f.jsonl:576).

**Expand M6's existing transit/safety cases**, with specific entry-to-analysis-to-RTP/model handoffs and effective agency policy. Other retained selections—expired feeds remain labelled, local catalog matches first, served stops as the median universe, 15/30-minute service tiers—are prior product decisions to check against current implementation, not universal transport standards. Sources: [feed expiry and local ranking, 2026-08-06T03:38:52.740Z](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/7ac6c1e3-0eb9-488e-8386-5404c00fc617.jsonl:194); [service-level statistics, 2026-08-06T01:15:28.207Z](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/c82ba255-2e66-4e76-81e5-07b42c3dd8ef.jsonl:162).

## Already explicit, superseded or not established

- Full US scope, deep California, separate validated models, days-long permissible runs, periodic independent whole-product review and agent autonomy are already explicit in renewed documents. Codex `01a03b76-82b5-7833-b3ce-7b601620ea9d`, `2026-08-26T01:29:34.277Z`, line 1376, contains a pasted Claude report followed by Nathaniel's own correction: **“I want ALL 50 before v1”** and **“The model runs can run for days if need be”**. Do not attribute the pasted agent report to him.
- Provider/API choice and agent-wide control are already explicit in A0/A1. The August 11 API-at-first-use instruction is superseded in mechanism by the current API-or-installed-CLI direction; preserve clear early setup/availability without requiring an API key from every user.
- Multilingual participation is already explicit in M9. The August 4 selection to expand the fixed language list should remain a language-coverage decision, not a reason to build a second translation system.
- August 4's choice to postpone a general persisted in-product audit view was a dated scope choice. Current capital/procurement/records/financial requirements require durable consequential histories before v1. Do not use that old postponement to remove the records needed for current workflows; distinguish those histories from an optional generic log browser.
- Broad agent-generated plans mentioning Buzz or a platform-wide assistant are not independently recovered user quotes. Current A1 is sufficient authority for the desired capability without reviving a particular abandoned product name.
- This audit did not recover a direct older user request specifically for benefit-cost analysis, TDM, every environmental subdiscipline or every existing module. Those may be justified by present product ambition and code/practice review; label that reasoning rather than inventing historical provenance.

## Coverage and limits

Reused the existing inventories and three completed requirements recovery reports. Inspected renewed roadmap/ledger definitions and searched their complete text for concrete outcomes; no edits to either. Re-examined only main OpenPlan Claude's **30 top-level files**, approximately 195 MB: **428 eligible short text entries**, and **51 structured answers (45 unique after duplicate-session removal)**. Read all unique answers; targeted direct-text terms yielded 28 distinct matching messages, including several handoffs explicitly excluded as independent user authorship. Source distinctions matter because user-role records can contain pasted agent plans, command results or automatic summaries.

Added a bounded four-session Codex sample selected from inventoried root work: `01a03b76...` (7 eligible messages), `01a0362c...` (4), `01a035b7...` (2), `01a0313b...` (2), approximately 119 MB total. Full IDs/paths are in the existing Codex inventory: `01a03b76-82b5-7833-b3ce-7b601620ea9d`, `01a0362c-cf90-7670-a893-a77738e29145`, `01a035b7-0318-7963-9e56-2c1291ceb274`, `01a0313b-3058-79e0-a5e9-e4daacb3cdd4`. The last three primarily start with transferred implementation plans, not original user prose; they confirm delegated scope but cannot be quoted as fresh direct requirements. The sample adds no missing independent requirement beyond the matches above.

The inventoried Codex/Claude coverage is not all months of OpenPlan history. Main Claude samples begin August 3; earlier July requests and March blueprint discussions, nested subagents, other OpenPlan Claude directories, unselected Codex sessions, hosted histories, OpenClaw and private T3 databases were not comprehensively searched. No unrelated personal records, credentials or accounts were accessed. No browser, application/database operation, test or process change occurred. All proposed additions need current-code assessment and real workflow evidence; this historical audit alone proves neither implementation nor usefulness.
