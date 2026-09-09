# M11 handoff history reconciliation, September 8 evening

Status: all prior user/assistant messages and both handoff/implementation notes read.
Relevant tool verification continues. This is not a claim that every bulk tool dump
or recovered screenshot has been inspected. The user was asked whether that much
broader line-by-line dump review is desired; no answer has arrived yet. Preserve
this distinction and continue the authorized implementation and consolidation.

## Source and reading record

Prior M11 session: 01a08215-d429-7813-8747-178f4af31327.
Source: /home/nathaniel/.codex/sessions/2026/09/08/rollout-2026-09-08T10-34-23-01a08215-d429-7813-8747-178f4af31327.jsonl.
SHA256: 843269f25422e54a18058689015931e1e27d786338380dc8b6d248722f610b4a.
The source has 9,439 records, 158,403,031 bytes. No source file was modified.

All 171 user/assistant response messages were extracted with source record numbers
and exact character boundaries, then read in five bounded chunks. This includes
the initial full instructions and plan, every progress message, the browser
interruption/recovery discussion and the final handoff. Five other response
messages contain harness instructions; the initial instruction blocks were also
read in the broader record review. The six function-call/output records were read,
including the two asynchronous user questions. IMPLEMENTATION.md was read fully
in contiguous character ranges 0–18000, 18000–36000, 36000–54000, 54000–72000 and
72000–79172. CONTINUE.md was read fully, as was this run's RESUMED.md.

Local custody and read ledgers are under:
/home/nathaniel/.local/state/openplan/m11-resumed-acceptance-2026-09-08/.
`conversation/manifest.json` records all five completed conversation chunks.
`history/` and `history-v2/` index every original record, text occurrence, metadata,
credential redaction, encrypted field and recovered image. `history-read/` retains
exact text plus exact-substring duplicate references; only chunks 1–6, 88 and 721 of 756 have
been read in full. Preparation/inventory is not reading. Raw transcripts and
captures stay local, outside Git. Only findings and nonconfidential receipts belong
in repository notes.

One early combined user-message read was tool-truncated. The full plan and full
instructions were subsequently read from the bounded chunk files. A later combined
conversation display elided a short part of the already-read plan; its complete
text was independently read in history chunk 5. No missing plan text was inferred.

Encrypted reasoning is unavailable as plaintext: 1,621 encrypted occurrences,
including duplicated compacted history, are individually indexed by source line,
field and hash in unavailable.json. These are not recovered private reasoning.
302 distinct embedded images were recovered byte-for-byte but are not yet all
visually reviewed. The original source itself contains shortened command outputs
and the user's abbreviated pasted browser-assessment transcript at record 9369.
Its displayed '+N lines' portions are not present in that pasted message. The
separate assessment report exists; its underlying full assessment-session transcript
has not yet been identified. Expired /tmp artifacts remain unavailable on disk;
embedded source/output records may recover some content but do not prove an old
runtime or download still exists. Credential-looking values are explicitly redacted
in reading copies; originals are not copied into repository notes.

## Instructions and approvals recovered

- Record 9 is the authoritative four-increment plan. It explicitly requires agency
  internal staff and two consultant orders first, then a small consulting practice.
  It preserves PM employee-cost access within assignments, finance-only private
  rates, scoped consultants, received/outgoing/reimbursement distinctions, exact
  source attribution and no duplicate cost. It requires deterministic forecasts,
  explicit calendars and reviews, staff proposal/PM acceptance, retained assumptions,
  actionable responses, reminders, settlement and immutable closeout/reopening.
- Record 9 also requires retry-safe requests, interrupted saves, isolated RLS,
  populated upgrades, worker recovery, desktop/390px/keyboard journeys, inspected
  PDF/XLSX and exported reconstruction. Neither synthetic engineering approval nor
  one release completes M11. Observed agency PM review and independent human finance
  acceptance are explicitly required. No later user message removes these conditions.
- Record 1554 asks permission for the prepared reminder CHECK replacement. Record
  1557 only acknowledges presentation of the question. No user approval reply exists.
  Records 9188, 9233 and 9369 concern browser recovery and continuation, not that SQL.
  The reminder migration remains unapplied; current notices must remain truthful.
- The current user's consolidation request authorizes landing all OpenPlan work to
  main. It supersedes the handoff's earlier no-merge scope. Active ownership still
  needs verification before changing main. It does not authorize paid services,
  actual agency decisions, outreach, or destructive database operations.

## Omissions, contradictions and recovered problems

The handoff preserves the full plan and principal remaining work. No later hidden
user approval or scope reduction was found in the conversation. Its acceptance
claims are deliberately narrower than milestone completion.

1. The old preview claim, 'changed input state' at records 9054/9122, covered loaded
   server state and worker lifecycle. It did not cover edits inside the form. This
   run reproduced stale displayed money after unchecking coverage and fixed it in
   aa66ac63. The new browser journey confirms clearing while retaining old reviews.
2. The 144,000-row measurement at record 9122 was honestly bounded, but was not the
   schema maximum. This run found 14,620,000 rows at maximum and JSON serialization
   failure, then compacted own daily totals into versioned format 2. Node maximum
   serialization now works. Adverse warning volume, browser clone/render, RPC and
   maximum export limits remain open.
3. The pre-commit save interruption at records 7617/7664 is real historical evidence
   of a retained failed request. It does not prove a lost response after commit.
   Our live practice test found re-normalization rejected a completed closeout's old
   hash. The current repair sends an identified retained request to SQL's existing
   actor/payload check. Exact replay succeeds; altered payload and different actor
   fail. This still requires appropriate request-path/browser recovery evidence.
4. Source-cutoff claims at records 3254–3385 refer to a conservative mutation ledger.
   They do not establish transaction-commit visibility. The handoff explicitly
   preserves this gap. No global transaction-isolation change has been made.
5. Artifact claims at records 7752, 8764–9014 distinguish issued old downloads from
   unissued new renderer checks. Preserve that distinction. This run issued a new
   format-7 report and recovered a killed PDF worker, but current browser delivery,
   byte comparisons and complete artifact inspection remain unfinished.
6. Former staff/consultant queue and permission failures were repaired in code and
   tested historically. The consultant's own corrected-invoice journey through the
   newer My Work entry is still open; do not substitute the earlier PM/finance
   correction journey at records 5021–5073.
7. The previous agent candidly corrected premature lint success, wrong worker PID,
   wrong live-test opt-in, ineffective mutation anchors, syntax-only fault failures,
   SQL NULL assertions, shuffled-test setup, view privilege and migration inventory
   omissions. These are not current failures merely because they appear in history.
   Their fixes need current checks; the old blanket-green claims cannot be reused.
8. The handoff's runtime PIDs, /tmp paths and closed A state were stale after restart
   and this run's synthetic reopening. RESUMED.md supersedes them. The other Codex
   process currently seen in main is a browser-tool app-server, not evidence of a
   second editing agent. All seven worktrees were clean at the consolidation scan.

## Current consolidation evidence

At 527cf048, seven worktrees have no tracked or untracked changes. Every non-M11
worktree HEAD is an ancestor of main 76f019bf. The only open PR is draft #107,
work/m11-delivery-closeout to main, with 25 commits absent from main at that point.
All 194 unique commits referenced by the last week's reflogs are contained in
local or remote branches. Full Git object inspection found 30 unreachable commits,
none dated September 1 or later, plus 574 blobs and 328 trees. These older objects
remain untouched. This does not prove that never-saved or garbage-collected work
can be recovered. No merge, branch deletion, reset or cleanup has occurred yet.

Current retry edits follow this inventory and will be checkpointed before landing.
Keep checks, main integration and final acceptance results separate from this
read-only inventory. A merge must retain every M11 commit and preserve all older
branch ancestry; do not squash away the evidence chain.

## Subsequent verification supersedes the earlier open findings

RESUMED.md records the completed source-visibility repair, actual issued PDF/XLSX
and closeout JSON/CSV downloads, complete PDF page overview review, all workbook
sheets and rendered overviews, worker lease recovery, and A/B shared-capacity
browser comparison. Those later records supersede the pending wording in items
2, 4 and 5 above only for their stated scope. Maximum missing-capacity calculation
also exposed and then repaired a second memory failure; maximum browser/RPC
acceptance and the consultant correction journey remain distinct unfinished work.
Chunks 88 and 721 were read fully to recover the populated-upgrade canonical
comparison and historical workbook/CI details. No other bulk chunks are counted
as read. The unavailable original temporary comparison file was not recovered;
its query and previously committed hash were recovered and independently matched.


Further complete bulk reading covers chunks 7–13 as well as 1–6, 88 and 721.
Chunk 8 contains an escaped duplicate of an already-read output: the decoded bytes
were checked for exact equality and the nonduplicate metadata/tail was read;
local `history-read/chunk8-equivalence.json` records the comparison. Chunks 9–12
recover the earlier contract guide, roadmap, capability ledger and complete
September 7 direction synthesis. They preserve independent human reconstruction,
full planning outcomes, and the disclosed older wrong-stack fixture incident.
That incident is historical evidence, not proof this M11 run touched that stack.
Chunk 13 is a historical truncated formatted-output copy; its untruncated stdout
was recovered and read in chunks 9–12. Other available bulk chunks remain unread;
this is still not an entire-history completion claim.

Later work now closes the own-consultant correction/lost-response case and the
measured maximum durable package case within RESUMED.md's explicit limits. New
failures and revisions, including the inaccurate SQL mutation receipt, are retained
there. The handoff did not authorize claiming those earlier partial checks as
complete. All seven GitHub checks passed on 782fcfd7; current uncommitted repairs
still need separate acceptance. Main consolidation remains authorized and pending.

Complete bulk reading now covers chunks 1–24, 88 and 721. Chunks 15, 23 and 24 were re-read separately after combined output truncation; truncated attempts were not counted. These chunks retain the v0.46 acceptance and original contract custody implementation. The old main nightly failure (run 34234455220, head 76f019bf) was already disclosed at IMPLEMENTATION.md line 16; the earlier agent promised follow-up. Current source inspection shows its moderation step omitted the now-required review reason and ignored rejected responses while waiting for success. A harness repair is prepared but has not yet been browser verified. This remains unfinished follow-through, not an assertion that the handoff concealed the failed run. Other bulk chunks and recovered images remain available but unread.

The original reading ledger additionally includes complete chunk 25. A local exact
line/reference ledger (`history-reference/ledger.json`) decodes valid JSON wrappers,
retains original representations and hashes, and references byte-identical repeated
lines. No semantic summarization is used to remove text. Its first four bounded
chunks were fully read; 400 chunks remain unread. It currently re-reads some passages
already covered indirectly by the original substring ledger; this wastes reading
but does not omit it. All 302 recovered unique images still require full visual
review. This remains an incomplete history review, not unavailable history.

The recovered nightly failure is now reproduced and repaired locally, with the
exact failure control in RESUMED.md. The review also led to the ordinary invoice
currency and reopened-obligation browser checks described there. Consolidation
into main remains authorized and pending the engineering checks; no branch or
worktree has been discarded.


Exact-reference chunks 1–10 have now been fully read (394 remain). They recover
the original M11 scope/ownership, shared-cap design and earlier source-custody forms;
no additional user approval was found. Repeated historical formatted truncation is
kept distinct from the recovered full output. Image review remains unfinished.


Exact-reference chunk 11 was re-read separately after a combined output truncation.
It retains the original master-authorization migration and binding M11 completion
criteria; chunks 1–11 are now read, 393 remain. No full-history completion is claimed.
