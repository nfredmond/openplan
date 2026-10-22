"""One-time revision of REPORT.md for supervisor notes 1-9. Each replacement must match exactly once.
Run: python3 -I scripts/revise_report.py <research_dir>"""
import sys
from pathlib import Path
P = Path(sys.argv[1]) / 'REPORT.md'
s = P.read_text()
R = []
def r(a, b): R.append((a, b))

# Header (notes 1, 5, 8, 9)
r("Read-only comparison. No OpenPlan file, branch, database, browser or deployment was touched, and no T3 code was built or run.",
  "Read-only comparison. The research agent changed no application code or operational settings, built or ran no T3 code, and exercised no provider-connector or model acceptance journeys. Tools used: git and `gh` (read-only) and the agent's own parsing scripts in [`scripts/`](scripts/).")
r("- PR corpus: all 13,199 pull requests (1,341 open, 6,753 closed without merge, 5,105 merged), captured 2026-10-15 01:44:01 to 01:44:53 UTC, file SHA-256 `2852de23041366abdbec9c9b6fd3e8470bdf67b9ca3a2c26bb2db9225bc8a16f` (re-verified).",
  "- PR corpus: all 13,199 pull requests numbered up to #19702 (1,341 open, 6,753 closed without merge, 5,105 merged), file SHA-256 `2852de23041366abdbec9c9b6fd3e8470bdf67b9ca3a2c26bb2db9225bc8a16f` (re-verified). Capture interval: earliest retained page 2026-10-15 01:43:13 UTC, collector resume 01:44:01 UTC, capture end 01:44:53 UTC. The resumed collector reused earlier pages, so this is not an atomic GitHub snapshot. [#19703], created at 01:45:00 UTC, is outside the census and appears only in the addendum in Appendix A.")
r("- OpenPlan compared at [`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`][op-commit] (clean pinned checkout `stage-a-main323-preview-20261015`).",
  "- OpenPlan compared at [`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`][op-commit] (clean pinned checkout `stage-a-main323-preview-20261015`). Two unmerged OpenPlan candidates outside that pin (PR327 and PR328) are known only from the supervisor's summary and were not inspected; see section 5.")

# Section 1 (note 8, 9)
r("Show update guidance for the installer that owns the binary; never run it.",
  "Show update guidance for the installer that owns the binary, and do not update automatically from discovery or probes (a proposed default; an update the person explicitly authorizes remains possible).")
r("consent page naming the destination host, credentials kept out of process arguments) into the ADR-004 successor.",
  "consent page naming the destination host, OpenPlan's MCP bearer and delegated authority kept out of process arguments and child environments) into the ADR-004 successor.")
r("Write T3's durable-orchestration lessons into the A1b assignment design.** Record intent",
  "Write T3's durable-orchestration lessons into the A1b assignment design.** Where these overlap the unmerged PR327 worker candidate (process observation, real cancellation), finish and validate that candidate rather than add a second owner. Record intent")
r("publish it in the app. This is low cost and supports V1 governance and customer installations.",
  "publish it in the app. Expected added work is one build-time generation step and a release check; its cost has not been measured. It supports V1 governance and customer installations.")
r("Not worth adopting: T3 Connect relays and tunnels,",
  "Not prioritized now (a prioritization judgment, not a contract ban): T3 Connect relays and tunnels,")

# Section 2 table and text (notes 2, 3, 4, 7)
r("| Deep review | Full body, complete changed-file list, human and bot comments via read-only `gh api` | 72 PRs (58 merged, 8 closed unmerged, 6 open) |",
  "| Full-body supplement (by the supervisor, not me) | Same regex rules with the 6,000-character cutoff removed ([`supervisor-fullbody/`](supervisor-fullbody/)); still keyword matching | 13,199 PRs; 477 theme-list changes; 17 relevance-class changes, all B or C to A |\n"
  "| Deep review | Complete cleaned body and complete files-endpoint list, read via [`scripts/full_text.py`](scripts/full_text.py); human comments, reviews and review comments as fetched by read-only `gh api` (issue comments cut at 4,000 characters, reviews at 2,500); bot comments counted, not read | 72 PRs (58 merged, 8 closed unmerged, 6 open) |\n"
  "| Pinned source inspection | Existence and specific lines at the pinned commit (`git cat-file`, `git show`, grep); a few small files read around the cited lines | 36 T3 paths |")
r("Patch hunks were not read for any PR. About 35 source files at the pinned commit were checked for existence, headers and specific lines. All 117 non-vendored documentation paths (13,938 lines) were read in full; 897 vendored third-party library docs under `.repos/` were path-screened only.",
  "Patch hunks were not read for any PR, and no comments were read for the 13,127 PRs outside the deep-review set. My first deep-review pass used bounded digests ([`scripts/digest.py`](scripts/digest.py): body prefixes, finally 900 characters; top 14 files; at most 3 human comments and 2 review comments of 350 characters). I then read the complete bodies and file lists for all 72 and rechecked each finding; this refined details (noted in [`evidence/deep-review-findings.jsonl`](evidence/deep-review-findings.jsonl)) but changed no recommendation. One API discrepancy: [#12296] declares 0 changed files while its files endpoint returns 4, fewer than its body describes, so its file census is incomplete. [#8962]'s upstream body is itself a GitHub rate-limit error string (confirmed by re-fetch). The 17 relevance upgrades in the full-body supplement are web UI, terminal and source-control PRs (for example [#4700], [#6218], [#18068]); I checked their titles and theme deltas and none changes a recommendation. Documentation: 117 first-party T3 paths (13,938 lines) were retrieved, which the script verifies; that I read them in full is my declaration, which the script cannot verify. The other 897 inventory paths are external upstream library docs under `.repos/` (alchemy-effect and effect-smol), not T3 product prose; they were path-screened only.")

# Table rows (notes 8, 9)
r("consent page names destination; credentials never in argv or child env |",
  "consent page names destination; OpenPlan's MCP bearer and delegated authority never in argv or child env (provider-native or API authentication the user configures may need its own environment) |")
r("| False positives in multilingual text; CPU negligible |",
  "| False positives in multilingual text; one extra text pass before AI calls, cost unmeasured |")
r("Merged [`4a4c6dd`][c-8962] (corpus body shows only a GraphQL error string)",
  "Merged [`4a4c6dd`][c-8962] (the upstream PR body is itself a GraphQL rate-limit error string, confirmed by re-fetch; evidence comes from its files, review comments and pinned source)")
r("| Integration, or MIT adaptation (T3 script imports `vite-plus`) | Medium (low cost) |",
  "| Integration, or MIT adaptation (T3 script imports `vite-plus`) | Medium (added build work unmeasured) |")
r("| Merged; e.g. [#19311] [`3417bc3`][c-19311]; [`serviceLauncher.ts` fit check][t3-launcher-fit] | [Backup and restore][op-backup-doc], restore drills, recovery manifests ([ledger, Oct 11][op-ledger]) |",
  "| Merged; e.g. [#19311] [`3417bc3`][c-19311]; [`serviceLauncher.ts` fit check][t3-launcher-fit] | [Backup and restore][op-backup-doc], retained-fixture restore drills, recovery manifests ([ledger, Oct 11][op-ledger]); second-host install and restore acceptance still open |")

# 4.1, 4.2, 4.5, 4.7, 4.8 (notes 8, 9, plus full-reading details)
r("- update guidance naming the installer that owns the binary, shown as a command for the person to run.",
  "- update guidance naming the installer that owns the binary, shown as a command for the person to run, with no automatic update triggered by discovery or health probes. [#9325] refuses when the install changed since the advisory and reports success only if the provider is still installed with a readable version afterward.")
r("Related fixes kept the MCP bearer token out of process arguments ([#17408]) and out of child environments (closed [#17887], merged [#17898]).",
  "Related fixes kept the MCP bearer token out of process arguments ([#17408]) and out of child environments (closed [#17887], merged [#17898]). For OpenPlan the transferable rule concerns its own MCP bearer and delegated authority; provider-native or API authentication that a person explicitly configures may legitimately need its own environment.")
r("T3 strips and counts invisible characters in shared prompt links and warns the user ([`promptLinks.ts` L61][t3-hidden-chars]).",
  "T3 strips and counts invisible characters (zero-width, bidi and tag characters) in shared prompt links, converts U+2028 and U+2029 to plain newlines so the draft shows the break the model reads, and warns that the prompt may be malicious ([`promptLinks.ts` L61][t3-hidden-chars]).")
r("and records what was last reported. [#16270] adds",
  "and records what was last reported. A watch ends when the PR merges or closes, after 10 consecutive comment-only wakes (so a chatty bot cannot loop an agent), or after 15 minutes of failed host reads, which itself wakes the agent with the reason so the interface never says \"Watching\" while nothing is read. [#16270] adds")
r("Established open-source tools can do this for npm and pip without porting T3's script, which depends on `vite-plus`.",
  "Existing open-source license tools for npm and pip may do this without porting T3's script, which depends on `vite-plus`; I did not evaluate them.")

# Section 5 (notes 5, 8)
r("| Whole-installation recovery | Restore drills, recovery packets, worker root sets (T3 has no whole-thread export) | [ledger, Oct 11 entries][op-ledger]; T3 [thread migration doc][t3-thread-migration] |",
  "| Whole-installation recovery preparation | Retained-fixture restore drills, recovery packets, transfer preparation and worker root sets (T3 has no whole-thread export). Independent second-host installation and restore acceptance remains open because no second computer is available | [ledger, Oct 11 entries][op-ledger]; T3 [thread migration doc][t3-thread-migration] |")
r("## 6. Not recommended, with reasons (inference)",
  "### 5.1 Unmerged OpenPlan candidates outside the pin\n\n"
  "Known only from the supervisor's note; I did not inspect either candidate. PR327 (`031e01f1ff9645fbd8c10935ab205baff6484307`) adds durable private worker process observations for 8 kinds, real transport cancellation, owned-attempt sequence and stopping guards, and a candidate migration not applied to the hosted database; process observation explicitly does not establish job completion. PR328 (`1f004f0894067225df75574d939968ecffac56ad`) adds an optional previous integration-encryption secret with a documented two-slot rollover. Both have local proof and await fresh GitHub verification and integration. Where item 3 (cascading Stop, telling a resumed agent what died) or any observability suggestion overlaps PR327, the recommendation is to finish and validate that candidate, not to start a second owner. I found no recommendation here that overlaps PR328.\n\n"
  "## 6. Not prioritized now, with reasons (prioritization judgment, not contract bans)")
r("| Public planning artifacts must be computed, sourced and approved; T3 needed several security fixes (local files, LAN access) to make them safe even for private use |",
  "| Executable arbitrary HTML in an evidence or publication path raises separate review and custody questions; T3 needed several security fixes (local file reads, LAN access, link hijacking) even for private use. Agent-written narration and optional reviewed visualization are not ruled out |")
r("| Consequential actions require a responsible human and exact approval custody |",
  "| OpenPlan's contract requires a responsible human and exact approval custody for consequential actions |")
r("| Arbitrary code extension conflicts with sourced adapters and records custody |",
  "| Third-party code extension is outside the current roadmap; T3's own PRs describe full trust in process ([#3699]) or a child process that is an availability boundary, not a sandbox ([#16047]) |")

# Section 7 (full reading)
r("| Closed for missing UI verification; relevant if A1d schedules agent work |",
  "| Closed under T3's UI-verification rule because captures did not cover the stacked archive UI in the cumulative diff; the author moved the direction to [Ideas discussion #6748](https://github.com/pingdotgg/t3code/discussions/6748). Relevant if A1d schedules agent work |")
r("| T3 still has no whole-thread export; OpenPlan M15c is further along |",
  "| [#7708] was closed by an automated open-PR pass as overlapping other work. T3 still has no whole-thread export; OpenPlan's M15c transfer preparation is broader, though its second-host acceptance is still open |")
r("| [#3699], [#16047] | Closed / open | Plugin systems | Not recommended |",
  "| [#3699], [#16047] | Closed / open | Plugin systems | Not prioritized (section 6) |")
r("| Closed for capacity or process; OpenPlan portal already localizes |",
  "| An earlier request was closed for maintainer capacity, [#14215] at the V2 rebase, and [#16087] in a bulk cleanup on a process reason its author disputes; no maintainer decision on community i18n appears in the fetched comments. Review lesson from [#16087]: an unknown stored locale should decode to a default rather than invalidate all settings. OpenPlan's portal already localizes |")

# Section 9 (note 9)
r("Item 7 adds scheduled outbound requests, reduced by conditional fetches. Item 5 is negligible CPU. None requires paid infrastructure;",
  "Item 7 adds scheduled outbound requests, reduced by conditional fetches. Item 5 adds one text pass before AI calls and item 8 one build step; neither cost has been measured. None requires paid infrastructure;")

# Section 10 (notes 2, 3, 6, 9)
r("- I did not read patch hunks or complete review threads for any PR, nor issues or Ideas discussions, so rejected-proposal reasons are as stated in PR comments.",
  "- I did not read patch hunks for any PR, bot review text for any PR, or comments for PRs outside the 72; human comments in the 72 were read as fetched, with long ones truncated (4,000 and 2,500 characters). Issues and Ideas discussions were not collected, so rejected-proposal reasons are as stated in PR comments.\n"
  "- [#12296]'s files endpoint returns 4 records while the PR declares 0 changed files and describes more; its file census is incomplete.\n"
  "- The supervisor's full-body supplement shows the 6,000-character cutoff changed theme lists for 477 PRs and relevance class for 17. Both screens are keyword matching, not semantic reading.\n"
  "- No application implementation, scientific acceptance, browser or practitioner acceptance, provider entitlement check or full dependency and license audit occurred. Copyright and specific dependency checks must be repeated before any future source extraction.")
r("- [#8962]'s corpus body is a GraphQL rate-limit error string; its description comes from files and comments.",
  "- [#8962]'s upstream body is a GraphQL rate-limit error string (re-fetched read-only into [`evidence/body-repair/`](evidence/body-repair/)); its description comes from files, review comments and pinned source.")
r("- I did not run any CLI, so actual drift between OpenPlan's pinned versions and versions installed by planners is unmeasured.",
  "- No provider-connector or model acceptance journeys were exercised (I used only git, read-only `gh` and my own scripts), so actual drift between OpenPlan's pinned versions and versions installed by planners is unmeasured.")

# Appendix A (notes 1, 3, 4)
r("checksum matches [`inventory.json`](inventory.json). Collection by [`collect.py`](collect.py) (paginated `pulls?state=all`) over 52 seconds; later PR changes are not reflected.",
  "checksum matches [`inventory.json`](inventory.json). Collection by [`collect.py`](collect.py) (paginated `pulls?state=all`). The earliest retained page dates from 01:43:13 UTC; the collector resumed at 01:44:01 UTC, reused earlier pages and finished at 01:44:53 UTC ([`supervisor-inventory-verification.json`](supervisor-inventory-verification.json)). The corpus is therefore not an atomic snapshot, and later PR changes are not reflected.\n\n"
  "**Post-cutoff addendum (not part of the census).** [#19703], \"feat(review): unify pull request and Git review across clients\", was created at 01:45:00 UTC and is open ([`post-cutoff-pr-19703.json`](post-cutoff-pr-19703.json)). It was not classified or reviewed.\n\n"
  "**Full-body supplement.** The supervisor reran my unchanged rules without the 6,000-character body cutoff into [`supervisor-fullbody/`](supervisor-fullbody/); my outputs were not overwritten. All 13,199 ids match; 477 rows changed theme lists (59 changed primary theme) and 17 changed relevance class ([`relevance-changes.json`](supervisor-fullbody/relevance-changes.json)).")
r("raw fetched JSON in [`pr-details/`](pr-details/).",
  "raw fetched JSON in [`pr-details/`](pr-details/). Reading level for all 72: complete cleaned body, complete files-endpoint list, human comments as fetched (truncated at 4,000 and 2,500 characters), bot comments counted only, no patch hunks. The reading texts are generated by [`scripts/full_text.py`](scripts/full_text.py) into `scratch/full/`.")
r("**Documentation.** 1,014 inventory paths: 117 T3 paths read in full (37 user guides,",
  "**Documentation.** 1,014 inventory paths. 117 are first-party T3 paths, retrieved (script-verified) and, by my declaration, read in full (37 user guides,")
r("897 vendored paths (739 alchemy-effect, 158 effect-smol) were path-screened; their two READMEs and licenses were checked. No path was missing or unreadable.",
  "897 are external upstream library docs under `.repos/` (739 alchemy-effect, 158 effect-smol), not T3-owned prose; they were path-screened only and not retrieved, and their two README heads (viewed with `git show`, output not retained) and licenses were checked. No first-party path was missing or unreadable.")

# Appendix B
r("python3 -I scripts/write_findings.py \"$PWD\"\n",
  "python3 -I scripts/write_findings.py \"$PWD\"\npython3 -I scripts/full_text.py \"$PWD\"        # complete reading texts for the 72 selected PRs\n")

for a, b in R:
    n = s.count(a)
    if n != 1:
        raise SystemExit(f'expected 1 match, found {n}: {a[:80]}')
    s = s.replace(a, b)
P.write_text(s)
print(f'applied {len(R)} replacements')
