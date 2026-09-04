# Procurement and consultant pursuits: bounded historical recovery

Reviewed 2026-09-04. Active checkout observed at `27c22b686051dbaad30c6ca94d345a705226c72b`; left untouched. The current explicit request for both consultant pursuits and agency procurement is binding whether or not its original wording can be recovered.

## Historical user evidence: limited result

No direct historical user message or structured user answer naming RFP, RFQ, procurement, solicitation, pursuit, or proposal was found in this bounded OpenPlan Claude sample. This is **not** evidence that Nathaniel never requested it: the sampled top-level Claude records begin August 3, while substantive proposal implementation already existed on July 27.

One broader direct user instruction is relevant but insufficient to infer the full procurement lifecycle. Claude session `1c269150-b74e-49e8-9414-b9e3a95fcaa6`, `2026-08-11T01:03:55.259Z`, line 7:

> invoicing to/from other agencies and/or consultants, project tracking, grant administration for grants you already got, grant application help with AI and auto search and calendaring/alerts/etc.

[Local source](/home/nathaniel/.claude/projects/-home-nathaniel-code-openplan/1c269150-b74e-49e8-9414-b9e3a95fcaa6.jsonl:7).

That establishes agency/consultant workflows and differentiated grant administration/application needs. It does not supply an exact older instruction to search solicitations, submit proposals, publish an agency solicitation, receive sealed submissions, evaluate applicants or award a contract. The new request should be preserved explicitly rather than attributed retroactively to this broader sentence.

## Prior plans: agency-side intent was documented

The repository's `docs/ops/2026-03-05-california-stage-gate-template-pack.md` is a dated, agent-authored scaffold. Its March 5 original text is also available at commit `88e2bd8c`. It identifies:

- Agreements/procurement gate: “Consultant selection package (RFP/RFQ path, scoring, conflict-of-interest attestation)”.
- Advertise/award gate: advertisement/bid package archive, bid analysis and award recommendation, civil-rights confirmation and pre-construction kickoff records.
- Construction/closeout: payment/change-order records, claims/disputes and financial closeout.

[Current retained historic scaffold](/home/nathaniel/code/openplan/docs/ops/2026-03-05-california-stage-gate-template-pack.md:55), [pinned historical version](https://github.com/nfredmond/openplan/blob/88e2bd8c65ab31fb01a6751e0011dd0b31ae3f54/docs/ops/2026-03-05-california-stage-gate-template-pack.md).

This is evidence that agency procurement was contemplated in prior project plans. It is **not** a direct Nathaniel quote, a verified legal checklist, or evidence of implemented publication/submission/evaluation access controls. The scaffold references two blueprint documents absent at their named current paths; no missing-reference assumption or external OpenClaw/private-store search was made to fill that provenance gap.

## Actual implementation history: consultant-side proposal work

Read full commit messages for these records. Their test/build claims are historical and were not rerun:

| Record | What the commit records | Implication |
| --- | --- | --- |
| `88e2bd8c65ab31fb01a6751e0011dd0b31ae3f54`, 2026-07-27T19:47:38-07:00 | Funding opportunities gain grant/proposal discriminator, solicitation number, submission-format note and questions deadline; proposal application sections grounded in solicitation, project and document evidence; fee placeholder not AI-drafted. | A consultant response already has an implementation home. |
| `4639880bbf034cd936b4a3a362165993d18d2287`, 2026-07-27T19:56:35-07:00 | Proposal selection/filter, solicitation fields, proposal workspace vocabulary and draft export cover. | Reuse existing pursuit/workspace/export flow before creating a second response product. |
| `ffc48cd10d835ea252edf7e12dbbb0b21bad8d00`, 2026-08-07T08:08:29-07:00 | Standalone drafter had silently treated proposals as grants, dropping solicitation context; shared merge restored it. | Multiple entry points can lose procurement meaning even when proposal schema exists. Current verification must exercise each reachable drafting/export path. |
| `8450299f9ba172cdbd3d687d8909129e5d2ebb29`, 2026-08-22T02:36:35-07:00 | Guided creation and regression checks for changing proposal back to grant; solicitation data should not leak into grant fields. | Keep grants and contract pursuits distinct despite sharing infrastructure. |

`CHANGELOG.md:1721` independently records the historical instruction to re-draft earlier RFP/RFQ responses because solicitation context had been omitted. Preserve that correction as a dated release record. [Changelog](/home/nathaniel/code/openplan/CHANGELOG.md:1721).

## Source terminology and limits

Selected current source confirms `PURSUIT_KINDS = ["grant", "proposal"]`; **the existing kind is `proposal`, not `solicitation`**. `openplan/src/lib/grants/pursuit.ts` and migration `20260727000015_pursuit_kind_and_solicitation.sql` explain a proposal as an RFP/RFQ response using the shared funding-opportunity registry, application workspace and export. Fields include solicitation number, submission-format note and questions deadline. This is consultant response infrastructure, not a demonstrated agency-owned procurement competition. [Current pursuit source](/home/nathaniel/code/openplan/openplan/src/lib/grants/pursuit.ts:1), [migration](/home/nathaniel/code/openplan/openplan/supabase/migrations/20260727000015_pursuit_kind_and_solicitation.sql:1).

No conclusion is made here about whether agency-side publication, controlled receipt, evaluation, award or external submission currently exists elsewhere. The parent review owns that current-code assessment. A recorded proposal status or exported document does not by itself prove a submission was received by an agency, nor that a procurement was conducted correctly.

## Coverage and remaining uncertainty

Reviewed inventory formats first: 86 OpenPlan Codex sessions, 80 Claude OpenPlan-related directories. Searched **30 top-level JSONL files, about 195 MB**, in only the main OpenPlan Claude project directory. Eligible direct-text search considered **428 short user entries**, excluding meta records, automated continuation summaries, task notifications and very large pasted logs. Also searched **51 structured question answers**. Targeted procurement terms produced no matches. A second search for bids, consultants, submission and evaluation/award phrasing recovered only the broad August 11 user passage quoted above.

Searched relevant current product/review/module documentation, changelog and bounded git subject history; read four implementation commit records, current pursuit source/migration, and the historical stage-gate scaffold. Also searched Markdown at the July 27 implementation revision to locate earlier plan references. No broad Codex content rescan, nested subagent history traversal, T3 database access, private OpenClaw-store access, remote Claude-session retrieval, browser, test, database, account or process operation occurred.

The July 27 commits cite a hosted Claude session, `session_01QfoXFDi6bVBcRWTipYYEUz`. Its underlying original user messages were not accessed; it is a possible future retrieval target if exact older wording matters. Until then, distinguish documented prior implementation and agent-authored intent from recovered user requirements. No raw histories, credentials or unrelated records were copied. Active checkout remained unmodified.
