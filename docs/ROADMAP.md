# OpenPlan roadmap to v1

<!-- openplan-active-roadmap
reviewed_commit: 380aad49770d856a9c4b577ccc9793baf39d3ddf
current_release: v0.68.0
review_by: 2026-11-06
paths:
- AGENTS.md
- CLAUDE.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/MILESTONES.md
- docs/product/AGENT_OPERATING_RULES.md
- docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md
- docs/reviews/product-direction/2026-10-06-integration-review.md
- docs/reviews/2026-10-12-two-month-review/PLAN.md
- openplan/scripts/ops/product-direction-review.mjs
- openplan/src/test/product-direction-review-guard.test.ts
- openplan/src/lib/safety/sources/registry.ts
- openplan/src/lib/auth/role-matrix.ts
- openplan/src/lib/runtime/action-metadata.ts
- docs/ops/KNOWN_ISSUES.md
- docs/modeling/WHERE_THE_NUMBER_STANDS_2026-08-20.md
- docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md
- docs/modeling/OPEN_SOURCE_MODEL_LANDSCAPE.md
- openplan/docs/ops/BACKUP_AND_RESTORE.md
- docs/ADRs/ADR-004-mcp-server-surface.md
- qa-harness/FIRST-WEEK-HARNESS.md
npm_commands:
- product:direction:check
- product:direction:packet
- ops:restore-drill
- test:workers
- test:rls-live
- qa:gate
-->

Status page and the only active queue, updated October 12, 2026. Full
definitions are in [MILESTONES.md](product/MILESTONES.md); dated evidence is in
the [evidence log](archive/ROADMAP_EVIDENCE_LOG_2026-08-24_TO_2026-10-12.md).
The header's `reviewed_commit` still names the October 6 direction review.
This page is not a new review. The M3 and M5b rows were updated October 14 from
the October 11 to 14 recovery and aerial evidence, also kept in the evidence log.

## Destination

OpenPlan v1 is a free, open-source operating system for core planning work in
the United States. Any type of planner, in any organization, in all 50 states
and DC can do their core work in it. California is the deepest proof.
AequilibraE and ActivitySim each pass untouched, use-specific validation for
every published use, and their results are never averaged. The
[v1 product contract](product/V1_PRODUCT_CONTRACT.md) is binding. No date,
release count or model runtime narrows it.

## Status by milestone

Statuses follow the two-month review's
[documentation audit](reviews/2026-10-12-two-month-review/reports/docs-audit.md)
and [plan](reviews/2026-10-12-two-month-review/PLAN.md). "Next" means Stage A
or B; "later" means Stage C or D. "Partial" and "mostly done" are the audit's
engineering verdicts. No milestone is done, because every Done line needs
observed planners or public participants. "Audit" means the audit is the latest
record. "PR" means a pull request open on October 12. KI-001 means
[known issue](ops/KNOWN_ISSUES.md) KI-2026-10-12-001.

| ID | Plain name | Status | Last evidence | Next action |
|---|---|---|---|---|
| M0 | Trustworthy releases and documents | In progress | [Oct 12 audit](reviews/2026-10-12-two-month-review/reports/docs-audit.md) | Finish the A3 documents pass |
| M1 | Plan geography and legal authority | In progress, partial | [Oct 7](reviews/2026-10-07-land-use-authority/IMPLEMENTATION_REPORT_RECOVERY_2026-10-07.md) | Fix KI-025; cross-state, MPO and tribal cases (C6) |
| M2 | One planning case through handoff | Later | Audit | Choose a cross-module case |
| M2a | Work-plan templates | Later | Audit | Grow 24 templates into a taxonomy |
| M2b | File library and document writing | Later (C10) | Audit | Drafting and review |
| M2c | Dashboard, My Work and appearance | In progress, partial | [PR 187](https://github.com/nfredmond/openplan/pull/187) | Show missed deadlines (KI-015, PR 243) |
| M2d | Work program (OWP/UPWP) administration | In progress, mostly done | [Sep 9](reviews/2026-09-09-owp-full-recovery/VERIFICATION.md) | Fix KI-002 to 004 (PR 252) |
| M3 | Free, private, recoverable operation | In progress, partial | [Oct 14 callback recovery](reviews/2026-10-14-aerial-callback-retry/STATUS.md); [roster recovery](reviews/2026-10-14-aerial-custody-recovery/STATUS.md); [retained access candidate](reviews/2026-10-14-artifact-access/STATUS.md); [terminal journal candidate](reviews/2026-10-14-terminal-delivery/STATUS.md) | Stage lease holder columns (rest of KI-018 after PR 258); installation-wide inventory and alignment; all-worker recovery; independent-host recovery; clean install |
| M3a | Desktop Control and demo recovery | Later, partial | [Sep 9](reviews/2026-09-09-control-main/VERIFICATION.md) | Observed acceptance |
| M4 | Confidentiality and records | Later | Audit | Records-request design |
| M5 | Data, GIS and analysis reuse | Later, partial | Audit | Format coverage matrix |
| M5a | Agency file formats | Next (B1a, C9) | Audit | Large uploads to Storage (KI-017, PR 255) |
| M5b | Drone work (M5b.1–6) | In progress | [Oct 14 custody](reviews/2026-10-14-aerial-immutable-custody/STATUS.md); [roster recovery](reviews/2026-10-14-aerial-custody-recovery/STATUS.md); [retained access candidate](reviews/2026-10-14-artifact-access/STATUS.md); [terminal journal candidate](reviews/2026-10-14-terminal-delivery/STATUS.md) | Complete callback/Storage recovery, preview rendering and default worker integration (M5b.2); name the DJI controller |
| M6 | Multimodal and safety decisions | Next (B3) | Audit | Safety action plan and SS4A |
| M6a | Transit, active travel and freight | Later | Audit | Transit service-plan case |
| M6b | Benefit-cost and demand management | In progress, partial | [Oct 6](reviews/2026-10-06-bca/VERIFICATION.md) | Bind BCA geography (KI-024) |
| M6c | Project prioritization | Later | Audit | Not started |
| M7 | Land use and development review | Later (C6) | Audit | Development-review case |
| M8 | Environmental, climate and equity | Later | Audit | Templates only |
| M8a | NEPA and CEQA review | Later | Audit | Not started |
| M8b | Civil rights program year | Later | Audit | Not started |
| M9a | Public map input | In progress, mostly done | [PR 196](https://github.com/nfredmond/openplan/pull/196) | Cap vote and upload abuse (KI-011 to 013, PR 253) |
| M9b | Moderate, interpret and respond | In progress, mostly done | [Oct 7](reviews/2026-10-07-synthesis-execution-queue/STAFF_RESPONSE_ACCEPTANCE.md) | Count every comment (KI-008, PR 242) |
| M9c | Beat Social Pinpoint, shown with people | Later | Audit | Comparative trial |
| M9d | Statutory hearing record | Later | Audit | Not started |
| M10 | Capital projects (M10a–d, a.1–d.2) | Later (C3) | Audit | California bridge case |
| M11 | Contract budgets and forecasts | In progress, mostly done | [Sep 9](reviews/2026-09-09-v047-release/VERIFICATION.md) | Fix KI-005 to 007 (PR 252) |
| M12 | RTP update from the adopted plan | Later (C1) | Audit | Prior-RTP intake without a paid key |
| M13 | Local tax and grant administration | Next (B5) | Audit | Recipient city role |
| M13e | Grant discovery and applications | Next (B4) | Audit | ATP scoring on screen |
| M13f | Agency audits | Later | Audit | Not started |
| M14 | Procurement, both sides | Later (C4) | Audit | Agency RFP issue and receipt |
| M15a | Hosted production recipe | In progress, mostly done | [Oct 11](ops/HOSTED_LIVE_2026-10-11.md) | Health checks (A1, PR 254) |
| M15b | Remote demonstration and trials | In progress, partial | [Oct 11](ops/HOSTED_LIVE_2026-10-11.md) | Invite teams after Stage A |
| M15c | Customer-owned installation | Later | Audit | Not started |
| S1 | Comparable model custody | In progress, partial | [Oct 8](reviews/2026-10-08-model-custody-metadata/DISPLAY_VERIFICATION.md) | Tier county runs by rules-v4 (KI-001, PR 244) |
| S2 | Model structure experiments | Later, partial | Audit | Experiments after S1 |
| S2a | TimesFM forecasting research | Later | [Sep 5](reviews/2026-09-04-pre-handoff/TIMESFM_TECHNICAL_RESEARCH.md) | Confirm license permits research |
| S3 | Untouched nationwide validation | Later | Audit | Successor preregistration |
| G1 | Every state and organization type | Later | Audit | Confirm state order (decision 6) |
| G1a | National local-assistance procedures | Later | [Sep 4](reviews/2026-09-04-pre-handoff/NATIONAL_LOCAL_ASSISTANCE_COMPARISON.md) | Read priority state manuals |
| A0 | Planner Agent provider choice | In progress, mostly done | [Sep 12](reviews/2026-09-12-api-project-ui/VERIFICATION.md) | Choice for broad chat (C8) |
| A1a | Truthful, scoped agent actions | Later, partial | [Sep 10](reviews/2026-09-10-agent-submittal-receipts/VERIFICATION.md) | Recovery for remaining writes |
| A1b | One durable agent assignment | Later (C8) | Audit | Not started |
| A1c | Agent jobs across modules | Later | Audit | Waits on A1b |
| A1d | Sustained use and outside clients | Later | Audit | MCP server (ADR-004) |
| V1 | Independent whole-product proof | Later (D) | Audit | Not started |
| W1 | Nat Ford website presents OpenPlan | On hold | [Website PR 20](https://github.com/nfredmond/nat-ford-website/pull/20) | Ask Nathaniel first |

The Maps module (PR 189, "M17" in the cutover record) and the UI overhaul
(PRs 186 to 188 and 193) have no milestone ID. [VERIFY: assign IDs at the next
direction review.]

## Next three, October 12, 2026

1. Land the Stage A2 defect fixes in PRs 242 to 245, 252 and 253: county run
   grading, money records, public input abuse, deadlines, comment counts and
   unknowns shown as zero. Check the merge hold first.
2. Give the live site its operating basics (Stage A1): health checks (PR 254),
   error tracking, a CI check for unapplied migrations, usage caps and a
   signup bot check.
3. Rerun the twelve first-week journeys against current main (Stage A3). The
   last full run was September 6. The result is the Stage B baseline.

Refill this list when an item closes. Change a table row only when its status
changes. Release notes go in the changelog; evidence stays in pull requests.

## Four stages to v1

The [two-month plan](reviews/2026-10-12-two-month-review/PLAN.md) sets these
stages. Its version numbers are indicative.

- **Stage A, safe to show (v0.69, section 5).** Operate the live site, fix
  defects that touch money, public input or a model claim, and make the
  documents true.
- **Stage B, find it and finish it (v0.70 to v0.73, section 6).** Every
  top-level page completes a real job or leaves. Then safety action plans,
  grants that reach submission, and local measures with recipient cities.
- **Stage C, the September 4 jobs (v0.74 to about v0.85, section 7).** RTP
  updates, maps without an agent, capital delivery, agency procurement,
  contract drawdown, land-use authority, aerial work, agent providers, data
  intake and documents.
- **Stage D, proof for v1.0 (section 8).** All 50 states and DC, untouched
  model validation, observed planners and the public, WCAG 2.2 AA, and every
  capability cell proven on one commit.

Section 9 keeps the post-v1 list, including Buzz agentic control.

## Related documents

- [V1 product contract](product/V1_PRODUCT_CONTRACT.md)
- [Milestone definitions](product/MILESTONES.md)
- [Core requirements ledger](product/CORE_REQUIREMENTS_LEDGER.md)
- [Known issues](ops/KNOWN_ISSUES.md)
- [Changelog](../CHANGELOG.md)
- [Roadmap evidence log](archive/ROADMAP_EVIDENCE_LOG_2026-08-24_TO_2026-10-12.md)
- [Two-month review](reviews/2026-10-12-two-month-review/README.md)
