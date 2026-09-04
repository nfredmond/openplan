# Historical requirements recovered: project administration and complete RTP work

Recovered 2026-09-04 from OpenPlan-scoped records. Current user instructions remain binding independently of historical recovery. This report distinguishes Nathaniel's recorded words/answers from agent-authored implementation claims.

## Conclusion

The broader requirements were present earlier. Direct records establish full RTP fiscal/public-review/performance/comment-response work, short- and long-term projects with costs/funding/maps, financial and policy elements, old-plan import including written chapters, and agency/consultant project administration with LAPM/other-funder invoices, drawdowns, budgets and timelines. These cannot be treated as newly invented scope or reduced to a thin tracking screen.

I did **not** recover the exact older wording requiring contract budget drawdown by task and employee from the bounded sample. Existing code does include employee-linked time, deliverable budgets and separate reimbursement drawdown; that is implementation evidence, not proof of the precise historical request or completion of an integrated contract workflow.

## Direct user evidence

Dates below are stored UTC timestamps; local dates can differ (August 11 02:04 UTC was August 10 evening Pacific). Quotes are short exact excerpts. Question prompts are agent-authored context; only the recorded answer is attributed to Nathaniel.

### Full RTP scope, August 4

Source: Claude session `455d9fc1-03c2-4b86-a77d-6c902a336459`, `2026-08-04T02:22:46.862Z`, structured user answers at line 324.

The agent asked which RTP capabilities must exist for “fully working” v1. Nathaniel selected fiscal constraint, public draft review, performance measures and comment-response record, then added:

> Project Lists, both long term and short term and their associated costs and how they'll be paid for, using an interactive map as part of this

He also required:

> a way to view and digest the information in the proposed financial element, as well as all the required elements, i.e., policy elements, etc.

[Local source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/455d9fc1-03c2-4b86-a77d-6c902a336459.jsonl:324).

This is explicit scope for a complete planning product, not only a release/adoption register. The agent's question proposed some items “follow”; Nathaniel selected all of them, so the question's narrower prioritization is not the accepted requirement.

### Invoice, drawdown and project administration, August 11

Claude session `1c269150-b74e-49e8-9414-b9e3a95fcaa6`, `2026-08-11T02:04:13.187Z`, line 333:

> be able to automate and fill in LAPM (and other agencies) invoice and keep track of project drawdowns and budget and timelines...

At `2026-08-11T02:05:05.366Z`, line 343:

> general project management and tracking for planning consulting firms and public agencies

[Invoice request](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:333), [project administration request](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:343).

These are direct requirements; the distinction between a consultant managing a contract and an agency invoicing a funder must survive consolidation. A grant-award reimbursement ledger alone does not establish the former.

### Assignments, deadlines and work-plan templates, August 11

Same session, `2026-08-11T17:14:27.203Z`, structured answers at line 1187. For My Work, Nathaniel chose “Assigned to me (Recommended)”; for stage-gate holds, “Distinct 'Blocked projects' block (Recommended)”; for reminders, “Daily digest, 7 days ahead (Recommended)”. On deliverable templates he wrote:

> Exhaustive list of all types of transportation planning projects, plans, and programs, as well as as exhaustive list of land use planning projects, plans, and programs. Many templates.

[Local source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:1187).

These choices establish user-facing assignment/deadline/template outcomes, not proof that existing templates exhaust planning practice. “Recommended” was part of the selected option label, not an independent review finding.

### Importing the previous RTP, including chapters, August 11

Same session, `2026-08-11T18:29:16.558Z`, structured answers at line 1290:

- Source citation in public plan page and board-export body: **“Everywhere, including the body”**.
- Pull written policy/goals/action chapters from old RTP into new drafts: **“Include chapters, verbatim blocks only”**.
- Transcribe the adopted plan's project/horizon/cost pairing rather than author a new phasing judgment: **“Yes — allow it, staged with the row quoted (Recommended)”**.

[Local source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:1290).

This explicitly requires old-plan reuse beyond structured finance rows while preserving authorship, review and provenance boundaries. It does not authorize invented connective text or silent adoption of extracted data.

### Preserve inconclusive fiscal states in drafting

Claude session `3c601fe3-3497-4944-9759-bba861f3f65d`, `2026-08-09T03:50:08.214Z`, line 2493:

> RTP chapter can draft when the verdict is not_determined, but with clear alerts and notes

[Local source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/3c601fe3-3497-4944-9759-bba861f3f65d.jsonl:2493).

Draft authoring and a proven fiscal determination remain separate; full authoring must not erase uncertainty.

## Dated implementation trail, not acceptance proof

Read commit messages and changed-file inventories for these actual commits; their test/review claims were not rerun here:

| Commit, local author date | Recorded work | Meaning for recovery |
| --- | --- | --- |
| `39c4be9d7b3792a3aaeb2aa599cc53e679e39739`, 2026-07-27 | Deliverable budgets/progress, project stated budget and spend entries | Budget granularity pre-existed the August request. |
| `223a68fee3a1cb8a33dfbb80539501852482d28e`, 2026-07-27 | Writable spend ledger and per-deliverable burn | Extend existing accounting-related seams before making a new module. |
| `dab9c160`, 2026-08-11 | Assignments, My Work, daily deadlines and work-plan templates | Personal delivery work was a deliberate outcome. |
| `50f9b03e7be7e0af1c6884fc3d041758650b2378`, 2026-08-11 | Adopted-plan extraction, staged acceptance, page citations and chapter transcription | Old-plan import was implemented in part, not merely discussed. |
| `d6a47ae98383d52bfacf0abc8637d5a5bdfc8706`, 2026-08-11 | Reimbursement drawdown ledger and review-labelled funder worksheet | Agency-to-funder claims are separate from consultant contract accounting. |

Current-source sampling at main `d2ce5c0f50d64d84cd57da6048f7b5afae3c2bb6` found:

- `openplan/src/lib/projects/budget.ts`: project/deliverable budgets and progress; `actualToDate` explicitly combines billed client-invoice lines with recorded spend. That is not independent proof of internal employee labor cost or a contract's remaining authorization. The money meanings need review before promising one integrated budget view.
- `openplan/src/lib/invoicing/time-billing.ts`: time entries include staff, engagement, deliverable, date, hours, labor category and billed-line linkage; grouping supports staff/category or deliverable. Rate lookup uses engagement/default tables and represents missing rates explicitly.
- `openplan/src/app/api/invoicing/time-entries/route.ts`: current stored/query fields include staff and deliverable identity. Field presence does not establish a complete task/employee/contract budget workflow.
- `openplan/docs/READING_AN_ADOPTED_PLAN.md`: current instructions for previous adopted RTP upload, extraction, review, conflicts, chapter/source custody and OCR. It explicitly limits extraction: no automatic project creation/name matching, and escalation rate entered manually.
- `docs/reviews/OPENPLAN_V1_CODEX_REVIEW_2026-08-25.md:226`: RTP described as broad fiscal/statutory/public-review machinery with a full adoption journey still to prove. This is an agent assessment, not a user scope reduction.

No browser, database or workflow test was run during this recovery. The root review should trace each user outcome through code and actual acceptance instead of treating the dated release descriptions as completion.

## Search coverage and remaining uncertainty

Inspected the existing inventory formats first: Codex inventory lists 86 OpenPlan sessions from 100 inspected headers; Claude inventory lists 80 OpenPlan-related directories, including acceptance agents. Searched only the main OpenPlan Claude directory's **30 top-level JSONL files**, not its hundreds of subagent histories. The first pass examined text-bearing user entries for metadata; targeted content search considered **428 eligible short direct-user text messages**, returning 19 keyword matches including duplicated sessions/handoff material. Excluded meta messages, task notifications, automatic continuation summaries and very large pasted logs from direct-user evidence. Separately searched structured `toolUseResult.answers` because actual user decisions reside there; those yielded the strongest RTP/import requirements.

Sampled user-message content in three inventoried Codex sessions: `01a016e6-7e88-7db3-a1fc-d20a3ebd0dcb` (48 eligible messages), `01a03207-3cc3-7a02-96fa-d89a082b6aa0` (9), `01a03a5b-d143-7893-a4c8-3e7fda7ed6d5` (2). No matching detailed contract/employee requirement recovered. Did not read all 86 Codex sessions or claim absence across all records.

Queried git subject history for drawdown, RTP, contracts, work programs, deliverables and invoicing; inspected five relevant commit records; searched current product/review/module documents and read the selected current source above. Several guessed documentation paths did not exist; searches were corrected to actual tracked paths. No missing guessed path is treated as a missing feature.

Git's additional refs include T3 checkpoint history dated July 29 and August 26. This indicates another potential record source, but no T3 database or private home directory was opened. Earlier July conversations, non-main Claude project directories, unselected Codex sessions and hosted session records may contain the exact contract/task/employee wording. A future strictly OpenPlan-scoped thread inventory could settle that. It is unnecessary to delay preserving the user's current explicit requirement.

Only sanitized excerpts and trace references appear here; raw histories, credentials and unrelated personal content remain outside the report. Active checkout remained unmodified.
