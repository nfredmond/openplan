# Resume after the weekly allowance reset

User requested continuous development through v1.0, direct main with no PRs and
no human release-review gates. The active goal remains through v1.0; do not mark it
complete. Resume in this thread when Nathaniel says continue. No paid infrastructure
or provider calls. Leave the pending reminder-constraint change untouched.

## Released and safe

v0.53.0 is published: https://github.com/nfredmond/openplan/releases/tag/v0.53.0
Release source e1618aa1cac020d2957816dbe747dbf59bd719e5, annotated tag
1a023eeb6c166b3e44d9c25fa8ed7601a8aaa455, published2026-09-10T18:01:25Z.
CI34509829077, RLS34509829003 and upgrade34509829115 all passed before tagging.
Full QA/shuffle13760pass378skip; RLS400pass; populated v0.52.1 upgrade passed.
Main publication receipt de01ce9b176d31752af44e0afd0245f505c9ae1f also has green CI/RLS.
Recheck remote state before acting. Claude evidence and limits live in the adjacent
2026-09-10-claude-native-spike review. No unfinished Claude release work remains.

## Current isolated lane

Worktree: /home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Branch: work/planner-agent-opencode-connection
Package remains0.53.0. OpenCode work is not merged into main or released.
Latest committed relay checkpoint before this handoff:1f57ff87. This handoff commit
adds the tested launch helper and receipts. Use git log/status to find its SHA.
Ownership: workers/planner_agent_connector/opencode-*.mjs, their tests and this review.
No subagents. Do not alter another session's checkout/server. Root has a preexisting
app server that is not ours; do not kill it or build/install over it. Owned3219
browser server was stopped after Claude acceptance. No native fixture needs to
survive the allowance reset.

Read CHECKPOINT.md, relay-checks.json, launch-checks.json and mutation receipts.
First product-direction check: npm run product:direction:check from this worktree's
openplan/ package. Read current roadmap A0/A1 and contract. This is existing A0b
provider work, not a new module. A0/A1 remain partial; all broader v1 obligations
remain in the roadmap. Do not restart previously completed OWP/contract work.

## Implemented, not yet wired

opencode-relay.mjs enforces one upstream OpenAI Responses call, exact model,
store=false, only StructuredOutput, fixed upstream, no redirects, byte/time limits.
28 relay tests,21 targeted unit mutation failures and harmless survivor; actual
native relay control and second-request mutation passed/failed as intended.

opencode-launch.mjs pins installed1.18.30 and mounts native auth.json read-only
for API credentials, with fresh private runtime directories.30 launch tests,
34 targeted mutation failures and harmless survivor. First inadequate file-type
fixture is retained separately. Positive native mount/launch/schema/assistant
readback proof passed. Default full connector suite151pass3native opt-in skips.

Not implemented: native account/model parsers, bounded owned server/process wrapper,
exact parent/result validation, adapter dispatch, app routes/types, migration, UI,
RLS and browser journeys. Do not advertise OpenCode support yet. First supported
mode will be native OpenAI API credentials; OAuth/subscription and other providers
remain explicit unimplemented scope. Use an unambiguous mode such as opencode_api
or explicit backend binding; existing apiKey claim inference currently means Codex.

## Next concrete steps

1. Native physical guard mutations are complete. The private production probe
   passed its harmless control and failed both writable-credential and exposed
   scratch mutations. A committed opt-in filesystem test independently passed
   its harmless control and failed five targeted mutations. See
   native-physical-mutations.json and native-filesystem-test-mutations.json.
   Run it with OPENPLAN_OPENCODE_NATIVE_BINARY pointing to the pinned binary:
   node --test workers/planner_agent_connector/test/opencode-native-filesystem.test.mjs.
   It uses only synthetic credentials, no model requests. Continue at step 2.
2. Implement sanitized native auth/model parsing and bounded owned server lifecycle.
   Let CLI read credentials. Never expose raw GET/provider: it contains keys.
   Bind model selection to actual native models output. Native gpt-6 is absent;
   gpt-6-astra exists in this installed catalog. Catalog is not account availability.
3. Native POST structured response and exact assistant-message GET work. General
   list-message GET rejects stored OutputFormat in this version. Use exact supplied
   parent message ID and assistant ID for the bounded verification; preserve this
   upstream limitation. Do not patch native DB or claim native history parity.
4. Challenge malformed/partial/native wrong-tool outputs, account/model changes,
   missing credentials, cancellation, private-file canaries and duplicate recovery.
   Then extend existing connector/SQL/UI with provider/account binding. Use the
   same retained project task and journal. No new orchestration stack needed.
5. Real desktop/390px navigation and downloads, keyboard, console, interruption,
   revocation, private histories, QA/shuffle/RLS/worker/upgrade, then direct main,
   final CI and a coherent minor release. Continue remaining v1 work afterward.

## Private artifacts and commands

Evidence: /home/nathaniel/.local/state/openplan/opencode-native-evidence-2026-09-10
Native binary: <evidence>/native/opencode (not installed on PATH).
Archive SHA25655007246858165496ff85ba1c2b648f7421e8e2013bf4189a680c9ff8e699d17.
Native source tag v1.18.30 at3104c1428ec91f809e5ab86631300de41eb6952e; MIT license read.
Source/API snapshots and protocol scripts are in that evidence directory.
- probe-production-physical.mjs: production launch + physical boundary checks +
  actual OpenAI Responses through relay + exact assistant readback. Fresh synthetic
  profiles per run; script now closes relay/fixture if physical probe fails early.
- probe-turn-openai-relay-failure.mjs: forced extra native request, strict budget.
- mutate-relay.py and mutate-launch.py: source mutation runners; finally restores.
- production-launch-turn.json / production-launch-assistant-readback.json: latest
  positive synthetic native output. Raw provider catalog is private, synthetic only.
- DESIGN-NOTES.md records earlier exploration. Do not commit private credentials.

Worker checks run from repo root:
node --test workers/planner_agent_connector/test/*.test.mjs
App tests/builds run from openplan/. Never use Vitest --root from repo root;
some tests inspect process cwd. The app .env.local points at the owned browser
fixture stack22301; don't print it. Named QA stack workdir is
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050 (API29821,
DB29822). Both stacks have315 migrations. RLS fixtures only on that named QA stack
with OPENPLAN_RLS_LIVE_TEST=1 and OPENPLAN_SUPABASE_WORKDIR set. No reset or DROP.

Browser evidence uses repository Playwright; authorized without asking. Read local
browser skill and identify the served build with scripts/ops/which-openplan.sh.
The earlier Claude private harness/evidence is in the sibling
claude-native-evidence-2026-09-10 directory. Never edit while an acceptance server
is collecting evidence. Original native Codex and Claude histories must survive.
