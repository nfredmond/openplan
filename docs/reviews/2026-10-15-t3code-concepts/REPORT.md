# T3 Code pull requests and documentation: what OpenPlan can use

Research date: October 14, 2026 (Pacific). Single research agent: Claude Opus 5.5 (`claude-opus-5-5`), no sub-agents.
Read-only comparison. The research agent changed no application code or operational settings, built or ran no T3 code, and exercised no provider-connector or model acceptance journeys. Tools used: git and `gh` (read-only) and the agent's own parsing scripts in [`scripts/`](scripts/).

- T3 Code source pinned at [`ec1313c8f8333292506f05a355bb72d308a455d8`][t3-commit] (main, committed 2026-10-14 18:15:53 -07:00, "fix(server): use workspace-scoped Bitbucket permissions API ([#10984])").
- PR corpus: all 13,199 pull requests numbered up to [#19702] (1,341 open, 6,753 closed without merge, 5,105 merged), file SHA-256 `2852de23041366abdbec9c9b6fd3e8470bdf67b9ca3a2c26bb2db9225bc8a16f` (re-verified). Capture interval: earliest retained page 2026-10-15 01:43:13 UTC, collector resume 01:44:01 UTC, capture end 01:44:53 UTC. The resumed collector reused earlier pages, so this is not an atomic GitHub snapshot. [#19703], created at 01:45:00 UTC, is outside the census and appears only in the addendum in Appendix A.
- OpenPlan compared at [`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`][op-commit] (clean pinned checkout `stage-a-main323-preview-20261015`). Two unmerged OpenPlan candidates outside that pin (PR327 and PR328) are known only from the supervisor's summary and were not inspected; see section 5.

Every recommendation below is my inference from the cited evidence. None is a product decision, a queue change, or a claim that something works for planners. Status words such as "merged" describe GitHub records, not verified behavior.

## 1. Short ranked recommendation

OpenPlan already holds most of what made T3 Code a useful reference in September: an installed-CLI connector with owned processes, frozen evidence packets, exact payload approvals, durable request journals, scrubbed error reports and honest "unknown is not zero" handling. In my reading, the September 4 [T3 reuse study][op-t3-study] remains accurate. What T3 has added since then, and what is most worth borrowing, is operating discipline around agents rather than new planning features. In priority order (all inference):

1. **Keep the installed-CLI connector usable as provider CLIs change (A0b).** Replace single exact-version pins with a dated, tested compatibility record backed by recorded replay fixtures, and report a usage limit as "limited until a stated reset" instead of a generic failure. Show update guidance for the installer that owns the binary, and do not update automatically from discovery or probes (a proposed default; an update the person explicitly authorizes remains possible).
2. **Make every agent-reachable tool declare who may call it before any MCP exposure (A1a).** T3's `McpToolAccess` refuses to compile an undeclared tool. OpenPlan's write actions already have a typed registry; its read tools and the future MCP surface do not. Carry T3's outside-agent sign-in lessons (read-only default, ceilings, consent page naming the destination host, OpenPlan's MCP bearer and delegated authority kept out of process arguments and child environments) into the ADR-004 successor.
3. **Write T3's durable-orchestration lessons into the A1b assignment design.** Where these overlap the unmerged PR327 worker candidate (process observation, real cancellation), finish and validate that candidate rather than add a second owner. Record intent and effect together, wake on commit and on durable deadlines, cascade Stop through dispatched work, tell a resumed agent which background work died, prune settled rows, and surface any pending human decision on the visible owner and in My Work.
4. **Flag hidden characters in untrusted text before it reaches a model.** OpenPlan already tells models that participant text is evidence, not instructions. It does not detect zero-width, bidi-override or Unicode tag characters in comments and documents headed for AI context. Detect and display them; never strip stored originals, and do not break scripts that need ZWJ/ZWNJ.
5. **Add a guided change review with code-enforced coverage** for predecessor-to-draft comparisons (prior RTP, OWP successor, document revisions). An optional agent writes the reading tour; code guarantees every changed section is covered and marks the tour stale when either version changes.
6. **Watch outside sources cheaply and let people judge.** T3's pull-request watch detects specific changes with a one-point fingerprint read and wakes only on meaningful events. The same shape fits grant deadline changes (B4/M13e), feed refreshes and rule-source currency (G1a).
7. **Generate a third-party license inventory at build time**, failing on dependencies without license text, and publish it in the app. Expected added work is one build-time generation step and a release check; its cost has not been measured. It supports V1 governance and customer installations.
8. Smaller items: auditable notification decisions (sent or suppressed, with reason), a self-service `openplan triage` playbook for operators, visible provenance for layered rules and settings, effective-permission visibility, upgrade preflight checks, accessible Planner Agent transcript structure, and AI usage records with explicit unknowns.

Not prioritized now (a prioritization judgment, not a contract ban): T3 Connect relays and tunnels, push notifications and Live Activities, the native mobile apps and offline caches, agent-authored HTML pages and MCP Apps as planning artifacts, AI-reviewed "Auto" approvals, the Full access default, the plugin systems, task graphs, and wholesale reuse of T3's Effect-based orchestration engine. Section 6 explains each.

Suggested placement (inference, no queue edits): nothing here should displace Stage A items A1 to A3. Items 4 and 7 fit Stage B hardening; item 6 fits B4; items 1 to 3 and 5 belong to Stage C (C8 agent providers, C1 RTP, C10 documents); upgrade and triage items support Stage D independent installation proof.

## 2. Method and coverage, in brief

Separate coverage levels; they are not interchangeable (details in Appendix A):

| Level | What was done | Scope |
| --- | --- | --- |
| Inventory | Verified the collected corpus: counts, uniqueness, checksum, capture interval | 13,199 PRs |
| Metadata screen | Deterministic regex classification of every PR's title, labels and first 6,000 characters of cleaned body ([`scripts/classify_prs.py`](scripts/classify_prs.py)) | 13,199 PRs; 127 unclassified |
| Title-level reading | Read titles in 22 focused theme lists ([`scripts/title_hits.py`](scripts/title_hits.py)); large lists filtered by size | 8,620 title hits (with overlap) |
| Full-body supplement (by the supervisor, not me) | Same regex rules with the 6,000-character cutoff removed ([`supervisor-fullbody/`](supervisor-fullbody/)); still keyword matching | 13,199 PRs; 477 theme-list changes; 17 relevance-class changes, all B or C to A |
| Deep review | Complete cleaned body and complete files-endpoint list, read via [`scripts/full_text.py`](scripts/full_text.py); human comments, reviews and review comments as fetched by read-only `gh api` (issue comments cut at 4,000 characters, reviews at 2,500); bot comments counted, not read | 72 PRs (58 merged, 8 closed unmerged, 6 open) |
| Pinned source inspection | Existence and specific lines at the pinned commit (`git cat-file`, `git show`, grep); a few small files read around the cited lines | 36 T3 paths |

Patch hunks were not read for any PR, and no comments were read for the 13,127 PRs outside the deep-review set. My first deep-review pass used bounded digests ([`scripts/digest.py`](scripts/digest.py): body prefixes, finally 900 characters; top 14 files; at most 3 human comments and 2 review comments of 350 characters). I then read the complete bodies and file lists for all 72 and rechecked each finding; this refined details (noted in [`evidence/deep-review-findings.jsonl`](evidence/deep-review-findings.jsonl)) but changed no recommendation. One API discrepancy: [#12296] declares 0 changed files while its files endpoint returns 4, fewer than its body describes, so its file census is incomplete. [#8962]'s upstream body is itself a GitHub rate-limit error string (confirmed by re-fetch). The 17 relevance upgrades in the full-body supplement are web UI, terminal and source-control PRs (for example [#4700], [#6218], [#18068]); I checked their titles and theme deltas and none changes a recommendation. Documentation: 117 first-party T3 paths (13,938 lines) were retrieved, which the script verifies; that I read them in full is my declaration, which the script cannot verify. The other 897 inventory paths are external upstream library docs under `.repos/` (alchemy-effect and effect-smol), not T3 product prose; they were path-screened only. Machine-readable outputs: [`evidence/pr-classification.tsv`](evidence/pr-classification.tsv), [`evidence/deep-review-selection.tsv`](evidence/deep-review-selection.tsv), [`evidence/deep-review-findings.jsonl`](evidence/deep-review-findings.jsonl), [`evidence/documentation-coverage.tsv`](evidence/documentation-coverage.tsv), [`evidence/coverage.json`](evidence/coverage.json).

### Collector review follow-up, October 15, 2026

GitHub review identifies two defects in the original selected-PR collector.
Failed CLI calls can become empty evidence, and paginated arrays can be
misread or discarded. The [correction](COLLECTOR_CORRECTION.md) now refuses
failed reads, preserves every page and refreshes legacy caches only after
complete collection. A separate fresh collection of the same 72 selected PRs
matches every original projected PR record and list exactly, including all
190 files for PR 3699. The upstream discrepancy for PR 12296 remains.
No original capture is overwritten, and no recommendation changes. This
later comparison does not recreate the earlier server state or establish
complete patches, untruncated comments or runtime acceptance.

## 3. Comparison table

Reuse class: **Inspiration** (design idea only), **MIT reuse** (copy a small file or function with attribution), **Integration** (connect an external open-source tool), **Lesson** (a failure mode to test for).

| # | Idea (inference) | T3 documentation and PRs | Status and commit evidence | OpenPlan counterpart | Planner use | Practical adaptation | Reuse class | Priority | Depends on | Risks and footprint | Evidence needed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Tested CLI compatibility record, replay fixtures, "limited until reset" state, owning-installer guidance | [Adding a provider][t3-adding-provider], [providers][t3-providers], [model manifest][t3-model-manifest], [testing strategy][t3-testing]; [#13533], [#12686], [#9325] | Merged: [#13533] [`9604f00`][c-13533], [#12686] [`be6b013`][c-12686], [#9325] [`2fb99a7`][c-9325]; worker at [`UsageLimitRecoveryWorker.ts`][t3-usagelimit] | Exact pins [Codex 0.154.0][op-codex-pin], [Claude 2.1.263][op-claude-pin], [OpenCode 1.18.30][op-opencode-pin]; Codex usage limit becomes a failure code [here][op-usage-limit] | A planner whose CLI auto-updated still gets a clear, safe answer about whether the connector is supported, and sees "limited until 4:40 pm" rather than "failed" | Keep refusal for untested versions but publish tested ranges with dates; record transcripts from real CLIs with synthetic content; parse reset time where the CLI reports it; no auto-resume by default | Inspiration; recorder scripts are MIT but Effect-coupled | High | A0b; Nathaniel's optional one-time recording session with his own accounts | Wider ranges without evidence; fixture recording consumes subscription allowance; repo size grows by fixtures (T3's Codex transcripts in [#13533] added roughly 70 to 625 lines each) | Fixture replay in CI, real installed-CLI acceptance per range, mutation proving an untested version is refused |
| 2 | Every agent-reachable tool declares who may call it; outside-agent sign-in design | [Environment auth][t3-env-auth], [orchestrator MCP server][t3-mcp-doc], [outside agents][t3-outside-agents]; [#16335], [#16336], [#16718], [#15219] | Merged: [#16335] [`2f85686`][c-16335], [#16336] [`2c8be58`][c-16336], [#16718] [`10f39eb`][c-16718]; [`McpToolAccess.ts`][t3-mcptoolaccess] | Typed write registry [`ACTION_METADATA`][op-action-metadata], [`action-registry.ts`][op-action-registry], [`action-approval-server.ts`][op-approval-server]; read tools defined per session in [`chat-tools.ts`][op-chat-tools] without access declarations; [ADR-004][op-adr004] | An outside client (or a planner's own Claude Code) can be given read-only project access without any path to publish, spend or approve | Extend the registry pattern to reads and to the MCP layer: each tool declares reads, proposes, or human-only; a lint/type guard rejects undeclared registration; consent page names destination; OpenPlan's MCP bearer and delegated authority never in argv or child env (provider-native or API authentication the user configures may need its own environment) | Inspiration (T3 code is Effect-specific) | High | A1a, ADR-004 successor, Supabase OAuth commissioning | Self-host OAuth configuration effort; scope creep into a general MCP server | Type-level negative tests, revocation test, wrong-workspace refusal, consent page naming host |
| 3 | Durable assignment mechanics: intent with effect, durable deadlines, cascading Stop, restart note, bounded retention | [Overview: durable intent][t3-overview], [server updates: recovering threads][t3-server-updates], [feature lifecycles][t3-lifecycles]; [#4656], [#16002], [#13895], [#9167], [#15323], [#16247], [#5246] | Merged: [#4656] [`2ea48ae`][c-4656], [#16002] [`f32c23c`][c-16002], [#13895] [`39e6fbb`][c-13895], [#16247] [`ca95267`][c-16247]; [`EffectOutbox.ts` retention][t3-outbox-retention], [`RestartBackgroundNote.ts`][t3-restart-note], [continuation limit][t3-continuation-limit] | A1b not started ([roadmap][op-roadmap]); provider turns already have attempt ids and leases ([migration][op-provider-migration]); [agentic control decision][op-agentic-decision] already specifies a bounded Postgres state machine | A planner who stops an assignment knows which dispatched jobs actually stopped; after a restart the agent is told which model run or export ended without a result | Specify in A1b: assignment step rows with `available_at`; post-commit wake plus a slow liveness poll; Stop as a cascading command with derived ids; resume note listing cancelled dispatched work; prune settled rows after a stated retention; at most N automatic continuations | Inspiration; lesson ([#5246] shows aggregate-only receipts are weaker than OpenPlan's payload hashes) | High when A1b starts | A1a truthful actions; existing worker journals | Duplicated state owners if workers and assignments disagree; Postgres row growth (bounded by pruning) | Interruption tests before and after commit, duplicate delivery, Stop during worker wait, retention mutation |
| 4 | Pending human decisions surface on the visible owner and in My Work | [Feature lifecycles: approvals][t3-lifecycles]; [#13726], [#19630], [#18101] (open) | Merged: [#13726] [`01dba73`][c-13726], [#19630] [`f4df794`][c-19630]; [`threadShell.ts`][t3-threadshell] | My Work query has no approval items ([`query.ts`][op-mywork]); approvals are synchronous in chat through the [approval server][op-approval-server] | A supervisor sees "awaiting your approval" on the project and in My Work, never "working" | When A1b adds waiting states, My Work lists them; a guard settles a late proposal card answered before it was written | Inspiration; lesson | Medium-High (with A1b) | A1b, M2c | Approval fatigue; duplicate alerts | Nested-wait test, late-card race test |
| 5 | Hidden-character inspection for AI-bound untrusted text | [Prompt links][t3-prompt-links]; [#18454] | Merged [`5fe7568`][c-18454]; regex at [`promptLinks.ts` L61][t3-hidden-chars] | Models told text is evidence ([`provider-project-task.ts` L70][op-evidence-instruction], [synthesis frame instructions][op-synthesis-frame]); `\p{C}` filtered only for locale names ([`locales.ts` L273][op-locales]) | Staff see that a public comment or uploaded PDF contains invisible instructions before an agent summarizes it | Detect and count; show escaped markers in moderation and in the AI-bound projection; keep original bytes; exempt ZWJ/ZWNJ inside scripts that need them (Persian, Indic) | MIT reuse of the regex with attribution, modified | Medium-High | Engagement moderation, chat context builders, document extraction | False positives in multilingual text; one extra text pass before AI calls, cost unmeasured | Fixtures with tag-character injection and legitimate Punjabi/Persian text; mutation removing detection must fail |
| 6 | Guided change review with code-enforced coverage | [Source control: review guides][t3-source-control]; [#18124] | Merged [`1f6df6b`][c-18124]; [`pullRequestReviewGuideNormalize.ts` L122][t3-guide-normalize] | Prior-RTP intake not reachable ([ledger CORE-RTP-02][op-ledger]); OWP source roles include predecessor ([`types.ts` L15][op-owp-types]) | An RTP reviewer reads a tour of what changed from the adopted plan; nothing changed is left out | Code computes the section/table diff and coverage; an optional model writes stops; excerpts must be exact changed spans; stale when either version changes; works without AI as a plain change list | Inspiration | Medium | M12a, M2b, M2d; document versioning | Model narration mistaken for review; large documents need worker time | Every changed span covered; stale after edit; recipient comprehension observed |
| 7 | Source watches: code detects, people judge | [Source control: PR watch][t3-source-control]; [#15057], [#16270] | Merged [`18b2132`][c-15057], [`758dc29`][c-16270] | Cron routes ([`vercel.json` crons][op-vercel]); [`refresh_gtfs_feed`][op-action-metadata] action; [cron heartbeat][op-cron-heartbeat] | A grants coordinator is told when an opportunity's deadline or amendment changed; a transit analyst when a feed publisher posts a new version | Per-source conditional fetch (ETag, Last-Modified, content hash) recorded with each decision; wake My Work only on defined changes; pause on rate limits; stop after repeated empty wakes | Inspiration | Medium | B4/M13e, G1a source currency, GTFS adapters | Source terms of use; outbound traffic on self-host; false "no change" when sources lack validators | Changed-deadline fixture, rate-limit pause, unknown-source state shown as unknown |
| 8 | Third-party license inventory and in-app notices | [Open source licenses][t3-licenses-doc]; [#8962] | Merged [`4a4c6dd`][c-8962] (the upstream PR body is itself a GraphQL rate-limit error string, confirmed by re-fetch; evidence comes from its files, review comments and pinned source) | Manual [LICENSE-NOTICE.md][op-license-notice]; no automated inventory found | An agency's counsel can read every bundled license before adopting | Use maintained OSS tools for npm and Python workers, or adapt T3's script; fail release builds on missing license text; publish a notices page | Integration, or MIT adaptation (T3 script imports `vite-plus`) | Medium (added build work unmeasured) | M0 release checks, M15c | Build time; false failures on packages missing metadata | Release CI failing on a planted unlicensed package |
| 9 | Auditable notification decisions | [#8491] (closed), [#10848], [#14986] | [#8491] closed unmerged; [#10848] [`fdf34c4`][c-10848]; [#14986] [`39516fb`][c-14986] | Digest counts delivered/skipped ([`work.ts` L237][op-work-digest]); engagement emails journaled ([`response-email-journal.ts`][op-email-journal]) | A supervisor can confirm a missed-deadline reminder was sent, or see why it was suppressed | Store one row per decision (sent, suppressed, failed, reason); order waiting-on-human items first; give each send a stable id and bounded retries | Inspiration; lesson | Medium-Low | M2c | Row growth (prune after retention) | Suppression reason test; duplicate-send test |
| 10 | Self-service triage playbook for operators | [Triage playbook][t3-playbook]; [#6563] | Merged [`324ddda`][c-6563] | [`scripts/ops`][op-scripts-ops] checks (health, restore, inventory); M3a desktop control | An agency IT person diagnoses a stalled worker without Nathaniel | `openplan triage` writes redacted facts (versions, deployed identity, health, worker inventory) and a maintained playbook; usable by hand or by the operator's own agent; read-only by default; never reads secrets | Inspiration | Medium-Low | M3a, M15c | Agent with shell on a production host; redaction gaps | Redaction tests; dry run on a disposable install |
| 11 | Visible provenance for layered rules and settings | [Project settings][t3-project-settings]; [#11176] | Merged [`2c0e891`][c-11176] | Plan authority vs workspace home defect ([KI-025][op-known-issues]); [architecture: geography and authority][op-architecture] | A consultant sees that a rule came from the client city's configuration, not from the consultancy's home state | Show the resolution chain (source registry, agency configuration, plan override) and "mixed" or "unresolved" states | Inspiration | Medium-Low | M1, G1 | Misleading chain if authority facts are wrong | Cross-state consultant case |
| 12 | Effective-permission visibility | [#9786], [#17370] | Merged [`28ce9d1`][c-9786], [`456930a`][c-17370] | [`role-matrix.ts`][op-role-matrix] | A member sees why an action is unavailable | Show effective role and the action matrix row; denials name the missing permission | Inspiration | Low-Medium | M4 | Disclosure of internal policy (low) | Role-by-role check |
| 13 | Upgrade preflight for independent installs | [Server updates][t3-server-updates]; [#5181], [#5374], [#19311], [#16102], [#15925] | Merged; e.g. [#19311] [`3417bc3`][c-19311]; [`serviceLauncher.ts` fit check][t3-launcher-fit] | [Backup and restore][op-backup-doc], retained-fixture restore drills, recovery manifests ([ledger, Oct 11][op-ledger]); second-host install and restore acceptance still open | An agency upgrade refuses before downtime if the capture cannot fit or cannot be verified | Add checks to the self-host upgrade runbook: free space for capture, verified capture, single owner of worker roots, migration-name clash detection for customized forks | Inspiration; lesson | Low-Medium | M15c | SQLite-specific details do not transfer to Postgres | Disposable-install rehearsal |
| 14 | Accessible Planner Agent transcript | [Consistency of action names][t3-action-names]; [#11199], [#13491] | Merged [`6cdbf76`][c-11199], [`393d595`][c-13491] (NVDA regressions reported after merge) | Planner Agent UI ([`assistant` components][op-assistant-components]); WCAG 2.2 AA in Stage D | A screen-reader user navigates agent messages by heading | Message headings, demoted markdown headings, accessible names that match visible actions | Inspiration; lesson | Low-Medium | Shared definition of done | Regressions without real screen-reader testing | NVDA/VoiceOver observation |
| 15 | AI usage with explicit unknowns | [Product analytics][t3-analytics], [usage][t3-usage]; [#9774] | Merged [`394e847`][c-9774] | Call-count limiter that fails open ([KI-014][op-known-issues], [`ai-rate-limit.ts`][op-ai-rate-limit]) | A workspace owner sees provider-reported tokens per AI task, with "not reported" where unknown | Record provider-reported usage per call when available; never infer cost from text length | Inspiration | Low | KI-014 work | More rows per AI call | Unknown-usage display test |

## 4. Recommendation details

### 4.1 Keep the connector usable as CLIs change (A0b)

T3's [adding-a-provider guide][t3-adding-provider] says a provider integration is judged by whether every feature behaves honestly, proves adapters with recorded transcripts replayed through the real adapter, and classifies quota errors as `usage_limit` with a reset time. [#13533] re-recorded every Codex fixture on a newer CLI when the old model was withdrawn. [#9325] runs updates only through the installer that provably owns the binary and verifies success by reading the version back.

OpenPlan's [connector README][op-connector-readme] intentionally accepts one exact native build per provider and says "a new native build requires protocol and capability acceptance before support is widened." That is the right safety rule. The practical problem (inference) is that the three CLIs update often; T3's fixtures were already recorded on Codex 0.156.1 while OpenPlan pins 0.154.0. Without a cheap way to accept new versions, A0's "every requested CLI backend" Done line will keep slipping. Suggested shape:

- a dated compatibility record per provider listing tested versions, the fixture set that proved each, and known limits;
- a recorder that captures the native protocol frames for OpenPlan's own project task using synthetic content, so CI replays real frames without paid calls;
- a `limited` turn state with the provider's reset time when it is reported, and no automatic retry unless the planner asks;
- update guidance naming the installer that owns the binary, shown as a command for the person to run, with no automatic update triggered by discovery or health probes. [#9325] refuses when the install changed since the advisory and reports success only if the provider is still installed with a readable version afterward.

### 4.2 Declared authority for every agent-reachable tool (A1a)

[#16335] replaced a dozen drifting permission helpers with seven declarations (`reads`, `readsAsCaller`, `actsAsCaller`, `writes`, `writesThreads`, `startsThreads`, `writesEnvironment`) in [`McpToolAccess.ts`][t3-mcptoolaccess]; a handler cannot be registered without one, and a lint rule keeps raw registration out. [#16336] and [#16718] added OAuth for outside agents with stateless registration, PKCE, read-only default, a mode ceiling, and a consent page that names the host receiving access. Related fixes kept the MCP bearer token out of process arguments ([#17408]) and out of child environments (closed [#17887], merged [#17898]). For OpenPlan the transferable rule concerns its own MCP bearer and delegated authority; provider-native or API authentication that a person explicitly configures may legitimately need its own environment.

OpenPlan's write actions already require metadata for every kind through the `ActionMetadataRegistry` type ([`action-metadata.ts` L19][op-action-metadata]). Read tools are assembled in [`chat-tools.ts`][op-chat-tools] under the user's session with budgets but no declared caller class. Before ADR-004 exposes anything to outside clients, each read and proposal tool should carry an explicit declaration (inference), and the human-only operations (publish, adopt, certify, spend, promote a claim) should be refusals that compile, not omissions. T3's "approving needs a full-access caller; declining does not" rule in open [#15464] is a useful asymmetry: an agent may decline or withdraw its own proposal, but only a person approves.

### 4.3 Durable assignment mechanics (A1b)

T3's [overview][t3-overview] states the core rule OpenPlan's [agentic control decision][op-agentic-decision] also states: a command acknowledgement means intent committed, not that work finished. The useful additions are concrete:

- **Deadlines, not polling.** [#4656] moved four executors from 50 ms polling (about 77 claims a second while idle) to post-commit wake plus sleeping until the earliest durable `availableAt`, with a 30-second liveness poll. On Supabase Micro compute this kind of idle load matters (inference).
- **Stop cascades.** [#16002] reports one real thread where Stop left 42 delegates running and about 1,400 watch wakes. Stop now walks delegated work depth first with command ids derived from the Stop, so retries stop nothing twice.
- **Tell the agent what died.** [#13895] records background work cancelled by a restart and prepends one bounded note to the next provider turn ([`RestartBackgroundNote.ts` L93][t3-restart-note]); the note is not shown as a fake user message.
- **Limits on automatic continuation.** Restart continuation refuses threads waiting on approval, answer or secret, and stops after three consecutive automatic continuations ([`RestartContinuation.ts` L30][t3-continuation-limit]).
- **Retention.** [#16247] prunes succeeded and cancelled effect rows after seven days in 500-row batches, keeps failed rows, and deliberately leaves event-store compaction unwired because it would break idempotent retries.
- **Receipts.** [#5246] fixed receipts replayed for a different aggregate and notes receipts still lack a payload fingerprint. OpenPlan's exact approved-payload hashes are stronger; keep them.

### 4.4 Pending human decisions on the visible owner

[#13726] made every approval or question raised by a nested subagent land on the top-level run; [#19630] makes the parent leave "Working", alert, and refuse snooze while a child waits. Open [#18101] documents a race where an answer arrives before its card exists. For OpenPlan (inference): when assignments wait on a planner's approval or a worker result needing review, My Work and the project should show that wait, and no queue view should show it as progress.

### 4.5 Hidden characters in untrusted text

T3 strips and counts invisible characters (zero-width, bidi and tag characters) in shared prompt links, converts U+2028 and U+2029 to plain newlines so the draft shows the break the model reads, and warns that the prompt may be malicious ([`promptLinks.ts` L61][t3-hidden-chars]). OpenPlan's hosted installation has been public since October 11 ([AGENTS.md][op-agents]); its engagement portals accept public comments, and OpenPlan feeds selected text to synthesis and moderation models. It already frames that text as evidence, and it already filters `\p{C}` for locale display names ([`locales.ts` L273][op-locales]), but I found no detection for AI-bound content. Adaptation (inference): detect and count; show visible escapes such as `⟨U+E0041⟩` in the moderation view and in the AI-bound projection; keep original bytes untouched, as OpenPlan's custody rules require. T3's regex removes ZWNJ (U+200C) and most ZWJ, which carry meaning in Persian and several Indic scripts that OpenPlan's portal supports, so a direct copy would damage legitimate text.

### 4.6 Guided change review with code-enforced coverage

[#18124] lets a read-only agent write a "tour" of a pull request, but the server enforces the shape: excerpts are clamped to changed lines, notes must sit inside them, every changed file appears in some stop, and the guide shows stale after a push ([normalizer][t3-guide-normalize]). This matches OpenPlan's rule that code computes and models narrate. For M12a (adopted RTP to update), M2d (OWP successor) and M2b (document revisions), OpenPlan could compute the section, table and figure differences, then let an optional model order and explain them, with code refusing a tour that omits a change (inference). Without AI, the same computed change list is the review.

### 4.7 Source watches

[#15057] moved pull-request babysitting from agent polling loops into the server: it wakes the thread only on a failed check, required checks passing, an outside comment, or a new conflict, and records what was last reported. A watch ends when the PR merges or closes, after 10 consecutive comment-only wakes (so a chatty bot cannot loop an agent), or after 15 minutes of failed host reads, which itself wakes the agent with the reason so the interface never says "Watching" while nothing is read. [#16270] adds a batched one-point "did anything change" read before full reads, about 90 percent fewer API points. The maintainer note that "the server finds events and the agent judges them" is the transferable rule. OpenPlan analogs (inference): Grants.gov opportunity changes for B4, transit feed versions, and rule-source currency records under G1a. Sources without validators should produce "unknown" rather than "unchanged".

### 4.8 License inventory

[#8962] generates notices at build time from installed production dependencies, fails strict builds when a package lacks license text, and shows a searchable notices page ([doc][t3-licenses-doc]). OpenPlan is Apache-2.0 with one manually documented vendored package ([LICENSE-NOTICE.md][op-license-notice]); the Python workers and Node app have no automated inventory that I found. Existing open-source license tools for npm and pip may do this without porting T3's script, which depends on `vite-plus`; I did not evaluate them.

### 4.9 Smaller items

- **Notification decisions.** Closed [#8491] proposed an outbox that records every notification decision, fired or suppressed, so replay cannot double-notify. OpenPlan's digest returns counts ([`work.ts` L237][op-work-digest]). Persisting each decision with its reason would make "consequential exceptions are not suppressed" testable (inference). [#14986] is a reminder to give every outbound send a stable id and bounded retries.
- **Triage playbook.** [#6563] treats the playbook as the product: machine facts in a context file, a maintained playbook fetched from main, consent before any write or issue. OpenPlan's self-service recovery requirement could use the same shape for operators, read-only by default.
- **Rule provenance.** T3 shows which layer supplied each setting ([project settings][t3-project-settings]). OpenPlan's M1 work separates plan authority from workspace home; a visible resolution chain would help reviewers spot wrong inheritance (inference).
- **Upgrade preflight.** [#19311] refuses an update whose backup cannot fit before stopping the server; [#16102] enforces one owner per state directory; [#15925] stops startup on a migration-id clash. The last matters for customer forks that add local migrations (M15c customization).
- **Accessibility.** [#11199], written by a contributor who uses a screen reader daily, gave each message a heading; [#13491] fixed announcements, then an NVDA user reported regressions. The lesson is OpenPlan's own: screen-reader behavior needs real assistive-technology checks.

## 5. Overlaps: already in OpenPlan

| T3 feature or rule | OpenPlan already has | Evidence |
| --- | --- | --- |
| Installed Codex, Claude Code, OpenCode adapters with owned processes | Connector with private profiles, refusals, journals, OS lock | [connector README][op-connector-readme], [`codex-launch.mjs`][op-codex-pin] |
| Execution stays with its owner; remote clients do not substitute credentials | Outbound connector; native login stays local | [architecture][op-architecture] |
| "Setup must not happen as a health-check side effect" | `models` command checks without generating | [connector README][op-connector-readme] |
| Command receipts for idempotent retries | Exact approved-payload hashes, single-use approvals, request journals | [`action-approval-server.ts`][op-approval-server] |
| Unknown counts stay absent, not zero | Contract rule and many guards | [V1 contract][op-contract], [`chat-context.ts`][op-chat-context] |
| Safe error log attributes | Scrubbed error reports, optional Sentry-envelope forwarding without SDK | [`error-report.ts`][op-error-report], [`sentry-envelope.ts`][op-sentry] |
| Citations that survive source change | Evidence descriptors with exact quotes, part ids, checksums | [`evidence-descriptor.ts`][op-evidence-descriptor] |
| Activity log that does not overstate success | Planner Agent activity ledger with outcome and actor | [`activity-summary.ts`][op-activity-summary] |
| Scheduled job liveness | Cron heartbeats with never/stale/healthy | [`cron-heartbeat.ts`][op-cron-heartbeat] |
| Whole-installation recovery preparation | Retained-fixture restore drills, recovery packets, transfer preparation and worker root sets (T3 has no whole-thread export). Independent second-host installation and restore acceptance remains open because no second computer is available | [ledger, Oct 11 entries][op-ledger]; T3 [thread migration doc][t3-thread-migration] |

### 5.1 Unmerged OpenPlan candidates outside the pin

Known only from the supervisor's note; I did not inspect either candidate. PR327 (`031e01f1ff9645fbd8c10935ab205baff6484307`) adds durable private worker process observations for 8 kinds, real transport cancellation, owned-attempt sequence and stopping guards, and a candidate migration not applied to the hosted database; process observation explicitly does not establish job completion. PR328 (`1f004f0894067225df75574d939968ecffac56ad`) adds an optional previous integration-encryption secret with a documented two-slot rollover. Both have local proof and await fresh GitHub verification and integration. Where item 3 (cascading Stop, telling a resumed agent what died) or any observability suggestion overlaps PR327, the recommendation is to finish and validate that candidate, not to start a second owner. I found no recommendation here that overlaps PR328.

## 6. Not prioritized now, with reasons (prioritization judgment, not contract bans)

| T3 item | Why not for OpenPlan |
| --- | --- |
| T3 Connect relay, managed tunnels, held webhooks ([t3-connect][t3-connect-doc], [#15487]) | Requires Cloudflare, Clerk, PlanetScale and Axiom accounts; OpenPlan's outbound connector avoids inbound tunnels; conflicts with no required paid infrastructure |
| Push notifications, Live Activities, widgets ([mobile notifications][t3-mobile-notifications], [#10848]) | Needs relay and APNs/FCM credentials; OpenPlan's mobile requirement is 390px web plus email |
| Native iOS/Android apps, offline caches ([#3795], [#18351]) | Large maintenance surface; offline sync is not requested by the contract |
| Agent-authored HTML pages and MCP Apps ([visual replies][t3-html-renders], [#15968], [#16236]) | Executable arbitrary HTML in an evidence or publication path raises separate review and custody questions; T3 needed several security fixes (local file reads, LAN access, link hijacking) even for private use. Agent-written narration and optional reviewed visualization are not ruled out |
| "Auto" AI-reviewed approvals ([#4272]) and Full access default ([permission modes][t3-permission-modes]) | OpenPlan's contract requires a responsible human and exact approval custody for consequential actions |
| Plugin runtime and marketplace (closed [#3699], open [#16047]) | Third-party code extension is outside the current roadmap; T3's own PRs describe full trust in process ([#3699]) or a child process that is an availability boundary, not a sandbox ([#16047]) |
| Task graphs across machines (closed [#17930]) | Declined upstream for scope; OpenPlan's A1b bounded state machine comes first |
| Turn provenance and selective rollback (closed [#10231]) | OpenPlan keeps immutable history and exact approvals |
| Webhook-triggered agent runs ([#15085]) | Inbound triggers that start agent work widen the attack surface; no stated planner need |
| Product analytics via PostHog (open [#15913], [telemetry][t3-telemetry]) | Unneeded for OpenPlan's goals; the audit ledger already records agent actions |
| Wholesale reuse of the orchestration engine, Electron shell, terminal, devices, SnapShots | Effect-based and coding-specific; a coding-agent IDE is not a planning module |

## 7. Relevant old, rejected and open proposals (ideas, not shipped features)

| PR | State | Idea | Note for OpenPlan |
| --- | --- | --- | --- |
| [#8491] | Closed unmerged | Server notification outbox recording fired and suppressed decisions | Adapt as item 9 |
| [#14354], [#14714] | Closed unmerged | Day/hour windows and run caps for scheduled tasks | Closed under T3's UI-verification rule because captures did not cover the stacked archive UI in the cumulative diff; the author moved the direction to [Ideas discussion #6748](https://github.com/pingdotgg/t3code/discussions/6748). Relevant if A1d schedules agent work |
| [#15040] | Open | Restricted agents cannot rewrite full-access scheduled tasks | Scheduled work must never exceed its author's authority |
| [#7708], [#7135] | Closed unmerged | Thread export/import between state directories | [#7708] was closed by an automated open-PR pass as overlapping other work. T3 still has no whole-thread export; OpenPlan's M15c transfer preparation is broader, though its second-host acceptance is still open |
| [#16731] | Open | Import a conversation into another environment, retry-safe | Low relevance |
| [#8676] to [#8731] | Closed unmerged | Large batch of MCP tools | Superseded by thin per-service wrappers ([#10554] to [#10566]); lesson for A1a |
| [#15464] | Open | MCP tools for approvals; approve needs full access, decline does not | Asymmetric authority, item 2 |
| [#17930] | Closed unmerged | Task graphs | Not now |
| [#10231] | Closed unmerged | Provenance and selective rollback | Not needed |
| [#3699], [#16047] | Closed / open | Plugin systems | Not prioritized (section 6) |
| [#11215], [#8577] | Closed unmerged | Usage-limit recovery | Superseded by merged [#12686]; item 1 |
| [#1132], [#6308] | Closed unmerged | Web push notifications | Not pursued upstream either |
| [#2450] | Closed unmerged | Sentry observability | T3 chose local traces plus optional OTLP |
| [#16087], [#8073], [#14215] | Closed unmerged | Community i18n | An earlier request was closed for maintainer capacity, [#14215] at the V2 rebase, and [#16087] in a bulk cleanup on a process reason its author disputes; no maintainer decision on community i18n appears in the fetched comments. Review lesson from [#16087]: an unknown stored locale should decode to a default rather than invalidate all settings. OpenPlan's portal already localizes |
| [#4504] | Closed unmerged | Interface accessibility remediation proposal | Reminder that accessibility needs owned, tested increments |
| [#1200] | Closed unmerged | Persistent memory system | OpenPlan keeps case memory in permissioned records |

## 8. Bounded implementation sequence mapped to the current roadmap

Recommendations only. The [roadmap][op-roadmap] remains the sole queue and is not edited here.

1. **Stage A (now).** No T3-derived work should displace A1 to A3. Optional: record item 5 as a candidate public-input hardening task with fixtures, since public signup is live.
2. **Stage B (v0.70 to v0.73).** Item 5 (hidden-character detection) alongside engagement work; item 8 (license inventory) as a release check; item 7 (source watches) scoped to B4 grant deadline changes; item 9 (notification decisions) if M2c deadline work continues.
3. **Stage C, C8 agent providers.** Item 1 first (it unblocks A0b), then item 2 as the A1a design gate, then items 3 and 4 inside the A1b assignment design and tests.
4. **Stage C, C1 RTP and C10 documents.** Item 6 for prior-RTP comparison and document revision review, after reviewed extraction exists.
5. **Stage C, M1 work.** Item 11 when plan-owned authority replaces workspace-home inference.
6. **Stage D.** Items 10 and 13 for independent installation, upgrade and recovery proof; item 14 within the accessibility campaign.

## 9. Licenses, reuse and footprint

- T3 Code is MIT, copyright 2026 T3 Tools Inc. ([LICENSE][t3-license]). The files I inspected carry no per-file license headers, so the root license applies. Vendored components keep their own terms (Ghostty MIT, react-native-uitextview MIT, MesloLGS Apache-2.0; [license config][t3-license-config]). `.repos/alchemy-effect` is Apache-2.0 and `.repos/effect-smol` is MIT; both are read-only references, not T3 code.
- OpenPlan is Apache-2.0 ([LICENSE-NOTICE.md][op-license-notice]). Copying MIT code into it is permitted with the MIT copyright and permission notice preserved.
- Direct reuse candidates are small and self-contained: the hidden-character regex ([`promptLinks.ts` L61][t3-hidden-chars], modified for multilingual text) and constant-time comparison ([`webhookVerification.ts` L7][t3-webhook-verify], though Node's `crypto.timingSafeEqual` alone suffices). Most other T3 code depends on Effect 4 and T3 contracts, so reuse means reimplementation, as the September study concluded.
- Footprint (inference): items 1, 2, 6, 8, 10, 11 add no runtime service. Items 3, 4, 9 and 15 add Postgres rows, bounded by retention. Item 7 adds scheduled outbound requests, reduced by conditional fetches. Item 5 adds one text pass before AI calls and item 8 one build step; neither cost has been measured. None requires paid infrastructure; fixture recording in item 1 consumes the recorder's own provider allowance.

## 10. Uncertainties

- "Merged" comes from GitHub's `merged_at`. [#9786] is recorded as merged although a maintainer comment says it was being closed; [#16335] says GitHub marked [#15961] merged by mistake. Merge-commit ancestry at the pinned commit was not checked (shallow clone). I confirmed presence at the pinned commit only for the files listed in this report.
- PR bodies describe tests and measurements I did not reproduce (for example, the 99.8 percent idle-claim reduction in [#4656] and 90 percent fewer API points in [#16270]).
- I did not read patch hunks for any PR, bot review text for any PR, or comments for PRs outside the 72; human comments in the 72 were read as fetched, with long ones truncated (4,000 and 2,500 characters). Issues and Ideas discussions were not collected, so rejected-proposal reasons are as stated in PR comments.
- [#12296]'s files endpoint returns 4 records while the PR declares 0 changed files and describes more; its file census is incomplete.
- The supervisor's full-body supplement shows the 6,000-character cutoff changed theme lists for 477 PRs and relevance class for 17. Both screens are keyword matching, not semantic reading.
- No application implementation, scientific acceptance, browser or practitioner acceptance, provider entitlement check or full dependency and license audit occurred. Copyright and specific dependency checks must be repeated before any future source extraction.
- The regex screen over-assigns broad themes (for example, "testing-verification" matched 8,920 PRs because most bodies describe verification). It was used to find candidates, not to measure prevalence.
- [#8962]'s upstream body is a GraphQL rate-limit error string (re-fetched read-only into [`evidence/body-repair/`](evidence/body-repair/)); its description comes from files, review comments and pinned source.
- No provider-connector or model acceptance journeys were exercised (I used only git, read-only `gh` and my own scripts), so actual drift between OpenPlan's pinned versions and versions installed by planners is unmeasured.
- OpenPlan file links assume the `nfredmond/openplan` repository is reachable at the pinned commit.
- AGENTS.md in T3 makes user-count claims; I did not use them.

## Appendix A. Coverage detail

**Corpus verification.** 13,199 unique PR numbers between 1 and 19,702 (numbers are shared with issues); 793 drafts; 9 empty bodies; created 2026-02-09 to 2026-10-15; checksum matches [`inventory.json`](inventory.json). Collection by [`collect.py`](collect.py) (paginated `pulls?state=all`). The earliest retained page dates from 01:43:13 UTC; the collector resumed at 01:44:01 UTC, reused earlier pages and finished at 01:44:53 UTC ([`supervisor-inventory-verification.json`](supervisor-inventory-verification.json)). The corpus is therefore not an atomic snapshot, and later PR changes are not reflected.

**Post-cutoff addendum (not part of the census).** [#19703], "feat(review): unify pull request and Git review across clients", was created at 01:45:00 UTC and is open ([`post-cutoff-pr-19703.json`](post-cutoff-pr-19703.json)). It was not classified or reviewed.

**Full-body supplement.** The supervisor reran my unchanged rules without the 6,000-character body cutoff into [`supervisor-fullbody/`](supervisor-fullbody/); my outputs were not overwritten. All 13,199 ids match; 477 rows changed theme lists (59 changed primary theme) and 17 changed relevance class ([`relevance-changes.json`](supervisor-fullbody/relevance-changes.json)).

**Metadata screen.** 28 themes with relevance classes A (maps to an OpenPlan home), B (transferable pattern), C (coding-IDE specific). Rules and per-status counts are in [`evidence/pr-classification-summary.json`](evidence/pr-classification-summary.json). Any-theme counts, merged / open / closed unmerged: provider integration 2,059 / 774 / 3,017; durable orchestration and recovery 989 / 346 / 1,611; approvals and permissions 195 / 118 / 385; delegation and handoff 221 / 123 / 311; MCP and external agents 149 / 62 / 210; scheduling and webhooks 107 / 55 / 193; notifications, mobile, offline 642 / 179 / 616; observability 427 / 105 / 394; update, install, migration 447 / 130 / 585; export and import 440 / 85 / 344; accessibility and i18n 142 / 23 / 180.

**Title-level lists read** ([`evidence/title-hits/`](evidence/title-hits/)): approval (166, read in full), security and injection (138, full), MCP and OAuth (199, full), scheduling and webhooks (155, full), notifications and offline (168, full), export/import/backup (324, merged plus XL/XXL proposals), recovery and durability (734, merged M+ plus XL/XXL proposals), observability (567, L+), update and migration (786, L+ filtered by keywords), citations and context (371, M+), accessibility and i18n (273, M+), questions and input (367, M+). Other lists were generated but read only by keyword search.

**Deep review selection rule.** For each OpenPlan-relevant theme: the PR that introduced the documented feature, hardening PRs that encode a failure mode, and significant open or rejected proposals. Full list with reasons in [`evidence/deep-review-selection.tsv`](evidence/deep-review-selection.tsv); per-PR mechanism, disposition and comment counts in [`evidence/deep-review-findings.jsonl`](evidence/deep-review-findings.jsonl); raw fetched JSON in [`pr-details/`](pr-details/). Reading level for all 72: complete cleaned body, complete files-endpoint list, human comments as fetched (truncated at 4,000 and 2,500 characters), bot comments counted only, no patch hunks. The reading texts are generated by [`scripts/full_text.py`](scripts/full_text.py) into `scratch/full/`.

**Documentation.** 1,014 inventory paths. 117 are first-party T3 paths, retrieved (script-verified) and, by my declaration, read in full (37 user guides, 30 internals, 9 orchestration-v2 design, 9 operations runbooks, 4 agent skills, 10 policy files, 13 component READMEs, 5 test-fixture READMEs); 20 of these were outside the sparse checkout and fetched with `git show` at the pinned commit into [`docs-extra/`](docs-extra/). 897 are external upstream library docs under `.repos/` (739 alchemy-effect, 158 effect-smol), not T3-owned prose; they were path-screened only and not retrieved, and their two README heads (viewed with `git show`, output not retained) and licenses were checked. No first-party path was missing or unreadable. Per-path record: [`evidence/documentation-coverage.tsv`](evidence/documentation-coverage.tsv).

**OpenPlan files read.** AGENTS.md; V1 contract; roadmap; core requirements ledger (full); milestone definitions for M2, M3, M3a, M4, M15, A0, A1, V1, W1; architecture; October 6 direction review; known issues (October 12 table and watch items); September 4 T3 reuse, provider, agentic options and agentic control reports; connector README and file list; `action-metadata.ts`, `provider-project-task.ts`, `provider-server.ts`, `activity-summary.ts`, `error-report.ts`, `sentry-envelope.ts`, `cron-heartbeat.ts`, `ai-rate-limit.ts`, `evidence-descriptor.ts` headers; targeted searches across `openplan/src`, migrations, scripts and workers. The capability matrix was located but only sampled.

## Appendix B. Reproduction

Run these commands in a working copy of the complete research package. Preserve
the original capture. Stop on a failed collection; retained legacy files do not
establish a successful refresh.

```sh
set -e
python3 -I scripts/doc_coverage.py "$PWD"
python3 -I scripts/classify_prs.py "$PWD"
python3 -I scripts/title_hits.py "$PWD"
python3 -I scripts/fetch_pr_details.py "$PWD"   # read-only gh api; reuses only intact v2 receipts
python3 -I scripts/write_findings.py "$PWD"
python3 -I scripts/full_text.py "$PWD"        # complete reading texts for the 72 selected PRs
python3 -I scripts/digest.py "$PWD" 16335 18124  # reading digest for any PR numbers
```

<!-- T3 commit and files -->
[t3-commit]: https://github.com/pingdotgg/t3code/commit/ec1313c8f8333292506f05a355bb72d308a455d8
[t3-license]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/LICENSE
[t3-license-config]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/third-party-licenses.config.json
[t3-overview]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/overview.md#durable-intent-and-side-effects
[t3-providers]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/providers.md
[t3-adding-provider]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/adding-a-provider.md
[t3-model-manifest]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/model-manifest.md
[t3-testing]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/orchestration-v2/testing-strategy.md
[t3-lifecycles]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/orchestration-v2/feature-lifecycles.md
[t3-mcp-doc]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/orchestration-v2/orchestrator-mcp-server.md
[t3-env-auth]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/environment-auth.md
[t3-server-updates]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/server-updates.md
[t3-analytics]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/product-analytics.md
[t3-licenses-doc]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/open-source-licenses.md
[t3-action-names]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/consistency-action-names.md
[t3-connect-doc]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/internals/t3-connect.md
[t3-outside-agents]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/outside-agents.md
[t3-prompt-links]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/prompt-links.md
[t3-source-control]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/source-control.md
[t3-project-settings]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/project-settings.md
[t3-permission-modes]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/permission-modes.md
[t3-html-renders]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/html-renders.md
[t3-mobile-notifications]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/mobile-notifications.md
[t3-usage]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/usage.md
[t3-telemetry]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/telemetry.md
[t3-thread-migration]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/docs/user/thread-migration.md
[t3-playbook]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/.github/triage/PLAYBOOK.md
[t3-mcptoolaccess]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/mcp/McpToolAccess.ts#L140
[t3-outbox-retention]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/orchestration-v2/EffectOutbox.ts#L164
[t3-restart-note]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/orchestration-v2/RestartBackgroundNote.ts#L93
[t3-continuation-limit]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/orchestration-v2/RestartContinuation.ts#L30
[t3-usagelimit]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts#L10
[t3-threadshell]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/packages/client-runtime/src/state/threadShell.ts#L69
[t3-hidden-chars]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/packages/shared/src/promptLinks.ts#L61
[t3-guide-normalize]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/pullRequest/pullRequestReviewGuideNormalize.ts#L122
[t3-launcher-fit]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/serviceLauncher.ts#L235
[t3-webhook-verify]: https://github.com/pingdotgg/t3code/blob/ec1313c8f8333292506f05a355bb72d308a455d8/apps/server/src/scheduledTasks/webhookVerification.ts#L7

<!-- T3 merge commits -->
[c-13533]: https://github.com/pingdotgg/t3code/commit/9604f00be6f27e12d2259d3a7370caba05a9d5fb
[c-12686]: https://github.com/pingdotgg/t3code/commit/be6b013a8c7f25646ff2154aacc15d9b2b9aca05
[c-9325]: https://github.com/pingdotgg/t3code/commit/2fb99a7a664faf045f1884f38c620016b34874cb
[c-16335]: https://github.com/pingdotgg/t3code/commit/2f85686d9dca5ec98c892a2a26c321e09d746d71
[c-16336]: https://github.com/pingdotgg/t3code/commit/2c8be5893eb3754071162e344a8c8e8a67bef597
[c-16718]: https://github.com/pingdotgg/t3code/commit/10f39eb9ac80c9a4b7f5097575dd2addc3b6f631
[c-4656]: https://github.com/pingdotgg/t3code/commit/2ea48ae7495e8953207324471cf9be07a8398be1
[c-16002]: https://github.com/pingdotgg/t3code/commit/f32c23cf1aa9ff177224e93c239165adc67798c0
[c-13895]: https://github.com/pingdotgg/t3code/commit/39e6fbb6d60167bae17881771180eb325c29c12d
[c-16247]: https://github.com/pingdotgg/t3code/commit/ca952677321abf9f3762ae4bb0129454e5a63955
[c-13726]: https://github.com/pingdotgg/t3code/commit/01dba73a688d8a67b0669e66e5200320165f8360
[c-19630]: https://github.com/pingdotgg/t3code/commit/f4df79477709185c490627a3fd43af96674ae778
[c-18454]: https://github.com/pingdotgg/t3code/commit/5fe7568e871c0310c83fac0484fb84bba14d9148
[c-18124]: https://github.com/pingdotgg/t3code/commit/1f6df6bf1f50ab5b8e3253716773da2571f8243e
[c-15057]: https://github.com/pingdotgg/t3code/commit/18b21325c3ab1ff4f0ee7b017d9c4eefc2b2d307
[c-16270]: https://github.com/pingdotgg/t3code/commit/758dc290e900e35958d37fec41fed4a357ad60fa
[c-8962]: https://github.com/pingdotgg/t3code/commit/4a4c6dd2adc350a68ba18bb28b24b5a7e4660dab
[c-10848]: https://github.com/pingdotgg/t3code/commit/fdf34c4018352df41aa22fbaa774c25c6c1ff7da
[c-14986]: https://github.com/pingdotgg/t3code/commit/39516fb197335bdfe062bd085a90bbd81e6655d1
[c-6563]: https://github.com/pingdotgg/t3code/commit/324ddda3146d54cc7195a67ef5506e93674085ba
[c-11176]: https://github.com/pingdotgg/t3code/commit/2c0e891740f86205784506a974096cf110b64da7
[c-9786]: https://github.com/pingdotgg/t3code/commit/28ce9d1c1751d70c869e3de3287b96d5e28fc845
[c-17370]: https://github.com/pingdotgg/t3code/commit/456930a09db29efdd3d4a397fe214e9ede2d6975
[c-19311]: https://github.com/pingdotgg/t3code/commit/3417bc3856a25fa772f969faeaf8428a58010d47
[c-11199]: https://github.com/pingdotgg/t3code/commit/6cdbf76fa4b0509913046abe6105037ded9e52bb
[c-13491]: https://github.com/pingdotgg/t3code/commit/393d595984f66df08504e1659997e12ad551bce9
[c-9774]: https://github.com/pingdotgg/t3code/commit/394e8470c89927a06575e08c434006b2320f1781

<!-- T3 pull requests -->
[#1132]: https://github.com/pingdotgg/t3code/pull/1132
[#1200]: https://github.com/pingdotgg/t3code/pull/1200
[#2450]: https://github.com/pingdotgg/t3code/pull/2450
[#3699]: https://github.com/pingdotgg/t3code/pull/3699
[#3795]: https://github.com/pingdotgg/t3code/pull/3795
[#4272]: https://github.com/pingdotgg/t3code/pull/4272
[#4504]: https://github.com/pingdotgg/t3code/pull/4504
[#4656]: https://github.com/pingdotgg/t3code/pull/4656
[#5181]: https://github.com/pingdotgg/t3code/pull/5181
[#5246]: https://github.com/pingdotgg/t3code/pull/5246
[#5374]: https://github.com/pingdotgg/t3code/pull/5374
[#6308]: https://github.com/pingdotgg/t3code/pull/6308
[#6563]: https://github.com/pingdotgg/t3code/pull/6563
[#7135]: https://github.com/pingdotgg/t3code/pull/7135
[#7708]: https://github.com/pingdotgg/t3code/pull/7708
[#8073]: https://github.com/pingdotgg/t3code/pull/8073
[#8491]: https://github.com/pingdotgg/t3code/pull/8491
[#8577]: https://github.com/pingdotgg/t3code/pull/8577
[#8676]: https://github.com/pingdotgg/t3code/pull/8676
[#8731]: https://github.com/pingdotgg/t3code/pull/8731
[#8962]: https://github.com/pingdotgg/t3code/pull/8962
[#9167]: https://github.com/pingdotgg/t3code/pull/9167
[#9325]: https://github.com/pingdotgg/t3code/pull/9325
[#9774]: https://github.com/pingdotgg/t3code/pull/9774
[#9786]: https://github.com/pingdotgg/t3code/pull/9786
[#10231]: https://github.com/pingdotgg/t3code/pull/10231
[#10848]: https://github.com/pingdotgg/t3code/pull/10848
[#11176]: https://github.com/pingdotgg/t3code/pull/11176
[#11199]: https://github.com/pingdotgg/t3code/pull/11199
[#11215]: https://github.com/pingdotgg/t3code/pull/11215
[#12686]: https://github.com/pingdotgg/t3code/pull/12686
[#13491]: https://github.com/pingdotgg/t3code/pull/13491
[#13533]: https://github.com/pingdotgg/t3code/pull/13533
[#13726]: https://github.com/pingdotgg/t3code/pull/13726
[#13895]: https://github.com/pingdotgg/t3code/pull/13895
[#14215]: https://github.com/pingdotgg/t3code/pull/14215
[#14354]: https://github.com/pingdotgg/t3code/pull/14354
[#14714]: https://github.com/pingdotgg/t3code/pull/14714
[#14986]: https://github.com/pingdotgg/t3code/pull/14986
[#15040]: https://github.com/pingdotgg/t3code/pull/15040
[#15057]: https://github.com/pingdotgg/t3code/pull/15057
[#15085]: https://github.com/pingdotgg/t3code/pull/15085
[#15219]: https://github.com/pingdotgg/t3code/pull/15219
[#15323]: https://github.com/pingdotgg/t3code/pull/15323
[#15464]: https://github.com/pingdotgg/t3code/pull/15464
[#15487]: https://github.com/pingdotgg/t3code/pull/15487
[#15913]: https://github.com/pingdotgg/t3code/pull/15913
[#15925]: https://github.com/pingdotgg/t3code/pull/15925
[#15968]: https://github.com/pingdotgg/t3code/pull/15968
[#16002]: https://github.com/pingdotgg/t3code/pull/16002
[#16047]: https://github.com/pingdotgg/t3code/pull/16047
[#16087]: https://github.com/pingdotgg/t3code/pull/16087
[#16102]: https://github.com/pingdotgg/t3code/pull/16102
[#16236]: https://github.com/pingdotgg/t3code/pull/16236
[#16247]: https://github.com/pingdotgg/t3code/pull/16247
[#16270]: https://github.com/pingdotgg/t3code/pull/16270
[#16335]: https://github.com/pingdotgg/t3code/pull/16335
[#16336]: https://github.com/pingdotgg/t3code/pull/16336
[#16718]: https://github.com/pingdotgg/t3code/pull/16718
[#16731]: https://github.com/pingdotgg/t3code/pull/16731
[#17370]: https://github.com/pingdotgg/t3code/pull/17370
[#17930]: https://github.com/pingdotgg/t3code/pull/17930
[#18101]: https://github.com/pingdotgg/t3code/pull/18101
[#18124]: https://github.com/pingdotgg/t3code/pull/18124
[#18351]: https://github.com/pingdotgg/t3code/pull/18351
[#18454]: https://github.com/pingdotgg/t3code/pull/18454
[#19311]: https://github.com/pingdotgg/t3code/pull/19311
[#19630]: https://github.com/pingdotgg/t3code/pull/19630

[#10554]: https://github.com/pingdotgg/t3code/pull/10554
[#10566]: https://github.com/pingdotgg/t3code/pull/10566
[#10984]: https://github.com/pingdotgg/t3code/pull/10984
[#15961]: https://github.com/pingdotgg/t3code/pull/15961
[#17408]: https://github.com/pingdotgg/t3code/pull/17408
[#17887]: https://github.com/pingdotgg/t3code/pull/17887
[#17898]: https://github.com/pingdotgg/t3code/pull/17898

[#4700]: https://github.com/pingdotgg/t3code/pull/4700
[#6218]: https://github.com/pingdotgg/t3code/pull/6218
[#12296]: https://github.com/pingdotgg/t3code/pull/12296
[#18068]: https://github.com/pingdotgg/t3code/pull/18068
[#19702]: https://github.com/pingdotgg/t3code/pull/19702
[#19703]: https://github.com/pingdotgg/t3code/pull/19703

<!-- OpenPlan pinned files -->
[op-commit]: https://github.com/nfredmond/openplan/commit/1b2fefe0f0e98f99700fc77e99146fe697b43ee7
[op-agents]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/AGENTS.md
[op-contract]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/product/V1_PRODUCT_CONTRACT.md
[op-roadmap]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/ROADMAP.md
[op-ledger]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/product/CORE_REQUIREMENTS_LEDGER.md
[op-architecture]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/ARCHITECTURE.md
[op-known-issues]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/ops/KNOWN_ISSUES.md
[op-adr004]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/ADRs/ADR-004-mcp-server-surface.md
[op-t3-study]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/reviews/2026-09-04-pre-handoff/T3_CODE_REUSE_RESEARCH.md
[op-agentic-decision]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/reviews/2026-09-04-pre-handoff/AGENTIC_CONTROL_DECISION.md
[op-license-notice]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/LICENSE-NOTICE.md
[op-backup-doc]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/docs/ops/BACKUP_AND_RESTORE.md
[op-connector-readme]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/workers/planner_agent_connector/README.md
[op-codex-pin]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/workers/planner_agent_connector/codex-launch.mjs#L6
[op-claude-pin]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/workers/planner_agent_connector/claude-launch.mjs#L6
[op-opencode-pin]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/workers/planner_agent_connector/opencode-launch.mjs#L7
[op-usage-limit]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/workers/planner_agent_connector/codex-provider.mjs#L64
[op-provider-migration]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/supabase/migrations/20261010000001_assistant_provider_connections.sql
[op-action-metadata]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/runtime/action-metadata.ts#L19
[op-action-registry]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/runtime/action-registry.ts
[op-approval-server]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/assistant/action-approval-server.ts
[op-chat-tools]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/assistant/chat-tools.ts#L383
[op-chat-context]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/assistant/chat-context.ts#L123
[op-evidence-instruction]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/assistant/provider-project-task.ts#L70
[op-synthesis-frame]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/engagement/synthesis-generation-thematic-v1.json#L5
[op-locales]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/engagement/portal-i18n/locales.ts#L273
[op-mywork]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/my-work/query.ts
[op-owp-types]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/programs/work-program/types.ts#L15
[op-vercel]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/vercel.json
[op-cron-heartbeat]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/notifications/cron-heartbeat.ts#L25
[op-work-digest]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/notifications/work.ts#L237
[op-email-journal]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/notifications/response-email-journal.ts
[op-scripts-ops]: https://github.com/nfredmond/openplan/tree/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/scripts/ops
[op-role-matrix]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/auth/role-matrix.ts
[op-assistant-components]: https://github.com/nfredmond/openplan/tree/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/components/assistant
[op-ai-rate-limit]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/runtime/ai-rate-limit.ts
[op-error-report]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/observability/error-report.ts
[op-sentry]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/observability/sentry-envelope.ts#L5
[op-evidence-descriptor]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/evidence/evidence-descriptor.ts
[op-activity-summary]: https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/openplan/src/lib/assistant/activity-summary.ts
