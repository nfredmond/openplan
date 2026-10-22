"""Join the deep-review selection, fetched PR details and the analyst's notes into
evidence/deep-review-findings.jsonl and evidence/coverage.json.
Run: python3 -I scripts/write_findings.py <research_dir>
Notes below are the analyst's reading of each PR's complete cleaned body, complete files-endpoint
list and fetched human comments (scratch/full/batch-NN.txt, from scripts/full_text.py). Comment text
was truncated at fetch (issue comments 4,000 chars; reviews and review comments 2,500). Bot comments
were counted, not read. Patch hunks were not read. Dispositions are recommendations (inference)."""
import json, re, sys, collections
from pathlib import Path

R = Path(sys.argv[1])
BOTS = re.compile(r'(\[bot\]|macroscope|cursor|vercel|coderabbit|github-actions|chatgpt-codex|greptile|devin)', re.I)

# number -> (mechanism read, OpenPlan disposition, OpenPlan home)
NOTES = {
 4272: ("Adds 'Auto' runtime mode: provider-side model reviewer approves routine permission prompts (Codex approvalsReviewer, Claude permissionMode auto).", "not-recommended: AI-reviewed approval conflicts with responsible-human approval custody", "action-metadata approval tiers"),
 13726: ("Every request a provider-native subagent raises lands on the top-level parent run at any depth; replay fixtures recorded live.", "inspiration: pending human decisions surface on the visible owner", "A1b / My Work"),
 19630: ("Client derives pendingSubagentRequest so a parent leaves 'Working', alerts, cannot be snoozed while a child waits on approval.", "inspiration: never show 'working' while a human decision is pending", "A1b / My Work / notifications"),
 18101: ("Open: answer can arrive before the approval card is written; EventSink normalization settles late cards in the same transaction.", "lesson: approval/receipt ordering race needs a transactional guard", "A1b approvals"),
 9786: ("Splits settings:write, providers:manage, environment:maintain scopes; typed denials name the missing scope.", "inspiration: narrower grants and typed denial naming the missing permission", "role-matrix / M4"),
 17370: ("Clients show their effective permissions; revocation/expiry closes live sockets; partial saves name failing environments.", "inspiration: effective-permission visibility", "role-matrix / M4"),
 16335: ("Every MCP tool built through one McpToolAccess declaration (reads, readsAsCaller, writes, startsThreads, writesEnvironment); compiler and lint rule refuse undeclared tools.", "inspiration (pattern), not code reuse: declare caller authority per tool before any MCP exposure", "action-registry / ADR-004 / A1a"),
 15907: ("request_secret tool: user enters a secret in a private card; agent receives a one-use secretRef, never the value; values expire.", "inspiration: agent requests a human-supplied value through a typed card, value kept out of model context", "A1b / workspace keys"),
 9167: ("Opt-in continuation of active threads after self-update restarts; marker records active turn; resumes only on match.", "inspiration for A1b restart semantics", "A1b"),
 15323: ("Restart recovery keeps delegated results, held queues and Stop intent intact; recovery benchmark included.", "lesson: recovery must preserve stop intent and ordering", "A1b"),
 13895: ("After restart, provider is told which background work was cancelled and will not report back (bounded note, delivered once).", "inspiration: tell the resumed agent and the planner which dispatched work died", "A1b + worker jobs"),
 4656: ("Effect executors wake on post-commit notification and sleep until the earliest durable availableAt; 30 s liveness poll; ~99.8% fewer idle claims.", "inspiration for A1b/worker polling cost", "A1b / workers"),
 5246: ("Command receipts replayed only for same aggregate; author notes receipts lack payload fingerprint.", "lesson: OpenPlan exact payload hashes already go further; keep them", "action-approval-server"),
 16247: ("Prunes succeeded/cancelled outbox rows after 7 days in 500-row batches; keeps failed rows; event-store compaction left unwired as unsafe.", "inspiration: bounded retention for settled job rows", "A1b / M3"),
 4400: ("Migrates v1 state lazily into v2 with idempotent manifest; does not pretend to migrate runs/checkpoints.", "lesson: honest partial migration; already OpenPlan practice", "M3 upgrades"),
 15442: ("Stop settles a stalled run after disk exhaustion; terminal writes guarded against late results.", "lesson for A1b cancellation", "A1b"),
 12686: ("Resume limited threads at provider-reported reset time; opt-in; survives restart; refuses stale deliveries.", "inspiration: distinct 'limited until reset' state, no silent retry", "A0b connector / A1b"),
 12352: ("Provider handoff selects intact messages within a byte/token budget, keeps current request intact, references omitted history retrievable by tool.", "inspiration: disclosed, auditable context transfer when switching backend", "A0b provider switching"),
 16002: ("Stop cascades to delegated tasks and PR watches via derived command ids; a stopped run cannot delegate or start watches.", "inspiration: cancellation cascades through dispatched work, reports what stopped", "A1b"),
 17930: ("Closed: task graphs across worktrees and machines; declined for missing prior scope approval.", "not-recommended now: bounded state machine first (A1b)", "A1c"),
 10231: ("Closed: turn provenance and selective rollback subsystem.", "not-recommended: OpenPlan keeps immutable history and exact approvals", "-"),
 16336: ("MCP OAuth for outside agents: discovery, stateless registration, PKCE, pairing-code or session approval, read-only default or mode ceiling.", "inspiration for A1a outside-client authentication", "ADR-004 / A1a"),
 16718: ("Hosted agents with https callbacks; approval page names the host that receives access.", "inspiration: consent page names the destination", "A1a"),
 15219: ("Tool parameters choose targets; credential sets limits; changes to other threads checked against caller ceiling.", "inspiration: target vs authority separation", "A1a"),
 8677: ("Closed large MCP project-management batch; superseded by thin per-service tools (#10563 series).", "lesson: expose thin wrappers over proven services, not broad new tool batches", "A1a"),
 15464: ("Open: MCP tools for approvals and thread diffs; approving needs full-access caller, declining does not.", "lesson: asymmetric authority for approve vs decline", "A1a"),
 15913: ("Open: anonymous PostHog events per MCP tool call and delegation outcome.", "not-recommended: product analytics; OpenPlan audit ledger already records actions", "-"),
 3638: ("Scheduled tasks: interval or fixed time, bound thread or fresh thread, crash-safe run state, agent-creatable via MCP.", "inspiration for A1d scheduled internal review", "A1d / cron routes"),
 15085: ("Webhook trigger: constant-time token, optional HMAC, rate limit, 1 MiB cap, delivery log with produced prompt, keyed by delivery id.", "not-recommended now (inbound agent triggers); delivery-log pattern noted", "-"),
 15487: ("Relay Durable Object holds webhooks while environment offline; caps and backoff.", "not-recommended: depends on paid relay infrastructure", "-"),
 15057: ("Server watches PRs; wakes the agent only on failed check, required checks passed, outside comment, or conflict; records what agent was told.", "inspiration: server detects, agent or planner judges", "M13e alerts / G1a source currency"),
 16270: ("1-point batched fingerprint read before full reads; ~90% fewer API points; rate limit pauses watching.", "inspiration: cheap change detection before expensive source reads", "data-sources adapters / cron"),
 14714: ("Closed unmerged: day/hour windows and run caps for scheduled tasks. Closed under the UI-verification rule because the cumulative stacked diff included archive UI that the captures did not show; author moved the direction to Ideas discussion #6748.", "rejected idea; relevant if OpenPlan schedules agent work", "A1d"),
 15040: ("Open: restricted agents cannot rewrite full-access scheduled tasks plus 13 server fixes.", "lesson: scheduled work must not escalate the author's authority", "A1d"),
 10848: ("Platform-neutral notification aggregation; waiting-on-human items prioritized before running rows.", "inspiration for digest ordering", "lib/notifications/work.ts"),
 11570: ("Opt-in in-app toast for activity in other threads; off by default; shares event detector.", "low relevance", "-"),
 3795: ("Persists last server config and refs for offline mobile/web hydration; never overwrites newer live data.", "not-recommended now: offline sync not requested", "-"),
 18351: ("Mobile keeps PR content offline with bounded cache (30 days, 256 records, 32 MiB).", "not-recommended now", "-"),
 8491: ("Closed unmerged (no closing reason in fetched human comments): server-side notification reactor; outbox row per candidate, fired or suppressed, with verdict and per-transport outcome; no catch-up on launch.", "rejected idea worth adapting: auditable notification decisions", "lib/notifications"),
 1697: ("Local NDJSON trace file plus optional OTLP export; instrumentation at RPC, orchestration, git, provider boundaries.", "partial overlap: OpenPlan has scrubbed error reports and cron heartbeats", "M15a / KI-033"),
 13697: ("Event-loop stall monitor writes a span with CPU, page faults, RSS when delay over 2 s.", "low relevance on Vercel; possible for long-lived workers", "workers"),
 13698: ("`t3 trace summary` reads rotated trace files offline: counts, rates, p50/p90/max.", "inspiration for worker operations", "workers / scripts/ops"),
 2679: ("Native resource telemetry child process with bounded history; demand-aware background work.", "inspiration only", "M3 measurements"),
 3405: ("safeErrorLogAttributes: logs error tags, trace ids, sanitized stacks; never messages or nested causes.", "overlap: OpenPlan error-report.ts already scrubs", "lib/observability"),
 6563: ("`npx t3 triage` writes machine facts and launches the user's own agent with a maintained playbook; consent before writes or issue filing.", "inspiration for self-service support", "scripts/ops / M3a / M15c"),
 14986: ("Analytics batches get UUIDs; jittered backoff; drop after 5 failures; stops a 25% duplicate-event loop.", "lesson for any outbound queue (email, callbacks)", "notifications / workers"),
 5181: ("Stable launcher owns version selection; candidates staged, prepared, then committed; rollback otherwise.", "inspiration for independent-install upgrades", "M15c"),
 5374: ("Snapshot SQLite before trial migrations; restore on rollback with durable restore marker.", "lesson (SQLite-specific); OpenPlan uses Postgres captures", "M3/M15c"),
 16102: ("Exclusive owner lock on state directory; second server exits 78; supervisors stop retrying.", "overlap: connector already uses an OS lock; consider for worker roots", "workers"),
 19311: ("Refuse update when backup cannot fit, before stopping the server; long preparation deadline for large DBs.", "inspiration for upgrade runbook checks", "M15c"),
 15925: ("Startup refuses when a recorded migration id would mask an upstream migration.", "lesson for customer forks with local migrations", "M15c customization"),
 7708: ("Closed unmerged by an automated open-PR pass as overlapping other work (#5499): export/import single threads between state directories, checksummed archive, terminal logs opt-in.", "contrast: OpenPlan M15c transfer preparation is broader in scope; second-host restore acceptance remains open", "-"),
 16731: ("Open: import conversation into another environment, retry-safe by derived thread id.", "low relevance", "-"),
 8066: ("Onboarding imports recent Codex/Claude conversations, best effort with limits.", "low relevance", "-"),
 16236: ("MCP Apps rendered inline with CSP and opaque origin; app tool calls need user consent unless read-only.", "not prioritized (judgment)", "-"),
 15968: ("Agents publish self-contained HTML pages; sandbox hardened against file:// and LAN access.", "not prioritized (judgment): executable arbitrary HTML in an evidence path is a separate review question; reviewed visualization is not ruled out", "-"),
 8962: ("Build-generated third-party license manifest; build fails when a package lacks license text; in-app notices page.", "integration/adaptation candidate", "M0 / M15c / V1 governance"),
 9146: ("Citations as self-contained links with excerpt and offsets; navigation refuses ambiguous matches.", "overlap: OpenPlan evidence descriptors and exact quotes already stronger", "lib/evidence"),
 12296: ("Threads attachable as context records (reference only, history read on demand). API discrepancy: PR declares changed_files 0 but the files endpoint returns 4 records (mobile and web composer files), fewer than the body describes; the census for this stacked PR is incomplete.", "low relevance", "-"),
 18454: ("Prompt links open a draft, never send; cannot change permissions; strip and warn on invisible characters.", "inspiration: hidden-character detection before AI context", "chat-context / engagement synthesis"),
 18124: ("Guided review: agent writes a tour; server clamps excerpts to changed lines, requires every changed file in some stop, marks guide stale after push.", "inspiration: code-enforced coverage of an agent-written change review", "M12a / M2b / M2d"),
 13491: ("Accessibility announcements and sidebar traversal; an NVDA user reported regressions after merge.", "lesson: real screen-reader testing", "Shared definition of done"),
 11199: ("Each chat message gets a visually hidden heading; markdown headings demoted.", "inspiration for Planner Agent transcript", "app-copilot"),
 16087: ("Closed unmerged in a bulk cleanup; the stated reason (model and harness not disclosed) was disputed by the author, whose body does name them. No maintainer decision on community i18n appears in fetched comments. Review lesson: unknown stored locale values should decode to a default rather than invalidate all settings.", "contrast: OpenPlan already has portal i18n catalogs", "-"),
 16047: ("Open: consented local plugins in supervised child processes; management kept on access:write.", "not prioritized (judgment): third-party code extension is outside current roadmap scope", "-"),
 3699: ("Closed unmerged by its author in favor of an 8-PR stack: runtime plugin marketplace with capability host, full trust in process.", "not prioritized (judgment)", "-"),
 9325: ("Provider updates only through the installer that provably owns the binary; success verified by re-reading version.", "inspiration: no automatic update from discovery or probes (proposed default; explicit authorized updates remain possible)", "A0b connector"),
 2312: ("Provider update advisories and update-state UI.", "low relevance", "-"),
 13533: ("Re-records Codex replay fixtures live on a newer CLI; recorder scrubs installation ids, home paths, hostnames and plan types from every frame; replay through real adapter and orchestrator.", "inspiration: recorded-transcript fixtures for each tested CLI version", "A0b connector tests"),
 9774: ("Custom model prices per environment; unknown prices no longer count as $0 silently.", "inspiration: AI usage with explicit unknowns", "ai-rate-limit / KI-014"),
 11176: ("One generic project override map with a single resolver; layer provenance shown in UI.", "inspiration: show which layer supplied a value", "M1 / G1 rule applicability"),
 12848: ("Undo for settle/snooze/archive with claim tokens so stale toasts never reverse newer actions.", "low relevance", "-"),
}

READING = ('complete cleaned body; complete files-endpoint list; human issue comments, reviews and review comments as fetched '
           '(issue comments truncated at 4,000 chars, reviews and review comments at 2,500); bot comments counted only; patch hunks not read')
BODY_NOTES = {8962: 'Upstream PR body is literally a GitHub rate-limit error string (verified by re-fetch, evidence/body-repair/8962.json); evidence for this PR comes from its file list, human review comments and pinned source.'}
sel = [l.split('\t') for l in (R/'evidence'/'deep-review-selection.tsv').read_text().splitlines()[1:] if l]
corpus = {json.loads(l)['number']: json.loads(l) for l in (R/'pull-requests.jsonl').open()}
out = []
for n, theme, reason in sel:
    n = int(n); d = json.loads((R/'pr-details'/f'{n}.json').read_text()); c = corpus[n]; pr = d.get('pr', {})
    mech, disp, home = NOTES[n]
    out.append({
        'number': n, 'url': c['html_url'], 'title': c['title'], 'theme': theme, 'selectionReason': reason,
        'status': 'merged' if c['merged_at'] else c['state'] + ('' if c['state'] == 'open' else '-unmerged'),
        'mergedAt': c['merged_at'], 'mergeCommitSha': pr.get('merge_commit_sha') if c['merged_at'] else None,
        'additions': pr.get('additions'), 'deletions': pr.get('deletions'), 'changedFiles': pr.get('changed_files'),
        'filesListed': len(d.get('files', [])),
        'humanIssueCommentsAndReviews': sum(1 for x in d.get('issueComments', []) + d.get('reviews', []) if x.get('body') and not BOTS.search(x.get('user') or '')),
        'humanReviewComments': sum(1 for x in d.get('reviewComments', []) if not BOTS.search(x.get('user') or '')),
        'botReviewComments': sum(1 for x in d.get('reviewComments', []) if BOTS.search(x.get('user') or '')),
        'readingLevel': READING,
        'apiFileCountDiscrepancy': (pr.get('changed_files') != len(d.get('files', []))),
        'bodyNote': BODY_NOTES.get(n),
        'mechanism': mech, 'openplanDisposition': disp, 'openplanHome': home,
    })
(R/'evidence'/'deep-review-findings.jsonl').write_text(''.join(json.dumps(o, ensure_ascii=False) + '\n' for o in out))

summ = json.loads((R/'evidence'/'pr-classification-summary.json').read_text())
docs = json.loads((R/'evidence'/'documentation-coverage-summary.json').read_text())
th_counts = {}
for f in sorted((R/'evidence'/'title-hits').glob('*.tsv')):
    rows = [l.split('\t') for l in f.read_text().splitlines() if l]
    th_counts[f.stem] = dict(collections.Counter(r[1] for r in rows), total=len(rows))
coverage = {
  'repository': 'pingdotgg/t3code',
  'sourceCommit': 'ec1313c8f8333292506f05a355bb72d308a455d8',
  'prCaptureInterval': {'earliestRetainedPage': '2026-10-15T01:43:13.543889Z', 'collectorResumeStart': '2026-10-15T01:44:01.270841+00:00', 'captureEnd': '2026-10-15T01:44:53.504602+00:00',
                        'note': 'Not an atomic GitHub snapshot: the resumed collector reused earlier pages. PR 19703 (created 01:45:00Z, open, "feat(review): unify pull request and Git review across clients") is post-cutoff and appears only as a labelled addendum (post-cutoff-pr-19703.json).'},
  'prCorpusSha256': '2852de23041366abdbec9c9b6fd3e8470bdf67b9ca3a2c26bb2db9225bc8a16f',
  'openplanCommit': '1b2fefe0f0e98f99700fc77e99146fe697b43ee7',
  'levels': {
    'L0_inventory_retrieved': {'pullRequests': 13199, 'open': 1341, 'closedUnmerged': 6753, 'merged': 5105, 'numberRange': [1, 19702], 'drafts': 793, 'emptyBodies': 9,
                                'note': 'GitHub numbers are shared with issues; 13199 PR numbers exist below 19702.'},
    'L1_metadata_screen': {'pullRequests': 13199, 'fieldsUsed': 'title, labels, first 6000 chars of cleaned body', 'unclassified': summ['unclassified'],
                           'method': 'scripts/classify_prs.py regex themes + conventional-commit scope hints', 'outputs': ['evidence/pr-classification.tsv', 'evidence/pr-classification.jsonl', 'evidence/pr-classification-summary.json']},
    'L2_title_level_theme_lists': {'method': 'scripts/title_hits.py', 'lists': th_counts, 'note': 'Titles in these lists were read by the analyst, filtered by size for large lists (see REPORT appendix).'},
    'L3_deep_review': {'pullRequests': len(out), 'byStatus': dict(collections.Counter(o['status'] for o in out)),
                       'reading': READING,
                       'apiFileCountDiscrepancies': [o['number'] for o in out if o['apiFileCountDiscrepancy']],
                       'history': 'First pass used bounded digests (scripts/digest.py: body prefixes, final setting 900 chars, top 14 files, at most 3 human issue comments and 2 review comments of 350 chars). Complete bodies and file lists were read afterwards via scripts/full_text.py; findings were rechecked against them.',
                       'outputs': ['evidence/deep-review-selection.tsv', 'evidence/deep-review-findings.jsonl', 'pr-details/*.json']},
    'L1b_supervisor_full_body_supplement': {'by': 'supervising Codex, not this agent', 'outputs': 'supervisor-fullbody/', 'pullRequests': 13199, 'themeAssignmentChanges': 477, 'bestRelevanceChanges': 17,
                                            'note': 'Same regex rules with the 6,000-char cutoff removed. Still keyword matching, not semantic reading. All 17 relevance changes move B or C to A; none is a PR this report recommends from, and none changes a recommendation (analyst check of titles and theme deltas).'},
    'L4_pinned_source_inspection': {'note': 'Separate from PR retrieval. 36 T3 paths at the pinned commit were checked for existence and specific lines (git cat-file/git show + grep); several small files (for example promptLinks.ts, handoffBudget.ts, McpToolAccess.ts, EffectOutbox.ts excerpts) were read around the cited lines. No T3 code was run or built.'},
  },
  'documentation': docs,
  'notDone': ['complete patch diffs for any PR', 'complete review discussions for the other 13,127 PRs', 'issues and discussions (Ideas) were not collected', 'vendored .repos documentation beyond path screening', 'running or building T3 Code'],
}
(R/'evidence'/'coverage.json').write_text(json.dumps(coverage, indent=2) + '\n')
print(len(out), coverage['levels']['L3_deep_review']['byStatus'])
