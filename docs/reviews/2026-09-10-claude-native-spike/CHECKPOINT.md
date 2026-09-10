# Claude Code native adapter, integration in progress

v0.52.0 is published at 914a9d966bbf1ea344b4d9ccd0762dbfa184aeea.
v0.52.1 dependency maintenance is published at 5d7ccdb067bb4db639132889f8efd5db160dfc6b.
The current main publication receipt is 00a650ab4b4db77c22e9626f69c6a3d6f4e4d077.
This separate work/planner-agent-claude-connection branch is not another released
backend. The worker now accepts version 2 provider-bound connection files and dispatches Claude. App routes, SQL and the project panel now include Claude. Focused checks pass; full QA, browser acceptance and release checks remain pending.

## Implemented transport boundary

Three worker modules add a pinned standalone Claude Code 2.1.263 Linux launch,
bounded owned-process IO and a narrow project-task wrapper. Native authentication
stays inside the CLI. Model/account mismatch, malformed/partial results, process
failure, cancellation, signed-out state and input/output limits refuse completion.
The native CLI has no tested non-generating catalog in this adapter; catalog
inspection explicitly returns modelsUnavailable instead of an invented list.

The isolated launch preserves the native credential file and masks other original
profile entries. It disables customizations, inherited settings, built-in tools,
MCP discovery, browser use, fast mode and session persistence. A private native
process receives only the frozen packet and an exact model. Bare mode is unsuitable
for this subscription path because current official docs say it ignores OAuth.
Managed-policy environments are refused until their requirements are tested.
A loopback-only Messages fixture parameter exists only for native tests; the
closed public connector configuration has no endpoint/environment override.

## Evidence and corrections

All 64 connector tests passed with both installed-native flags enabled. This
includes the existing 33 Codex/connector cases, 30 Claude unit cases and one
actual-native fixture that exercises several related boundaries. The Claude
fixture uses synthetic OAuth and a local Messages server. It forces Bash, Read,
Write, WebFetch and MCP calls, checks refusals and missing host/project/skill/key
canaries, checks the actual mount namespace, preserves source settings, completes
one wrapped structured turn, observes signed-out refusal without a model call,
and cancels a native request without regeneration. No real Claude model request
or paid API request was made. Native auth status alone was checked against the
existing account, with only sanitized mode/plan fields retained.

The first refusal assertion omitted the actual phrase "No such tool available".
It was corrected without removing the refusal requirement. Removing safe mode
alone survived the first native mutation because the other restrictions remained;
that outcome is retained. Stronger mutations exposed private profile entries,
inherited project instructions, enabled tools and changed account modes. Harmless
controls survived. See the adjacent mutation receipts and private detailed logs.

A repeat-connection fixture found a real defect: an empty mask for .claude.json
made native status exit with a configuration-corruption error. The corrected mask
uses an empty JSON object for JSON files. The original file remains unchanged.
The restored test passes, and reverting the mask reproduces the failure. A repeated
native connection, signed-out refusal and cancellation now run through the complete
wrapper, not just the stream parser.

## Remaining work

Before merging as supported functionality, finish full QA, shuffled tests, isolated
RLS, browser acceptance and upgrade checks. v1 Codex setup files and old seven-argument
connection issuance remain compatible; the new panel requests explicit v2 bindings. Prove wrong-provider refusal, exact retry,
revocation, cancellation and private history in the database and from real desktop
and 390px navigation. No silent provider or billing fallback. Additional native
backends, broader grounded tasks, MCP and assignments remain roadmap obligations.

Source research read September 10, 2026:

- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/authentication
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

The June 15 update on the last source pauses the announced SDK credit change;
subscription use remains subject to provider limits. This does not establish
future terms, unlimited use or whether a particular account has enabled paid extra
usage. No real generation should assume an extra-usage setting. T3's prior MIT
source review remains the reuse reference. Direct native CLI streaming avoids
importing its entire editor/SDK/orchestration stack for this narrow task.

## Launch and connector checkpoint

The restored connector suite now passes 96 tests with both installed native flags,
zero failures and zero skips. The extra launch tests exposed a missing scratch
filesystem-root guard, now fixed. Invalid fixture URLs are normalized to the
specific refusal before filesystem access. One harmless launch mutation survived;
16 targeted changes failed. Root-path mutation runs used a read-only outer mount
namespace so broken code could not write outside disposable /tmp fixtures.

Version 1 setup files and provider-less legacy jobs remain Codex. Version 2 binds
Codex or Claude to its permitted account mode and requires the claimed job's exact
provider. Generation dispatch, result checking and retained receipts use that
choice. A lost Claude delivery response resends the identical saved answer without
inspection or regeneration. Wrong-provider output and journal replay are refused.
One harmless dispatch control survived and eight targeted changes failed, including
actual native CLI inspection and generation being incorrectly sent through Codex.
The native fixture now runs the public CLI models command with a private v2 config;
it reports Claude subscription mode and explicit catalog unavailability.

Blind categories: synthetic native responses do not establish live Claude model
availability, allowance, paid extra-usage settings or provider outages. Launch
fixtures test permissions and symlinks as the current user, not a distinct UID or
an installed /etc managed policy. The sandbox does not prove independent failure
of safe mode; that earlier surviving mutation remains recorded. Worker tests do
not establish database isolation or browser reachability. Those are next.

## App and database checkpoint

The candidate adds Installed Claude Code in the existing project panel, v2 native
connection issuance, Claude queued requests and provider-aware delivery. The
migration extends the existing tables, checks and native connection identity;
it does not remove records. A composite foreign key prevents retained requests
from being rebound to another provider or account. The original connection RPC
and legacy setup shape remain available to older callers. All native histories
stay within the same personal access and project retention protections.

The named disposable QA database applied migration 20261011000001. Its 81 existing
connection rows and 91 saved turns retained identical aggregate row checksums.
The restored focused suite passes 101 tests across routes, panel and both native
providers' live RLS/custody cases. TypeScript and lint passed. Eleven targeted
SQL function mutations, four constraint/permission mutations and their harmless
controls behaved as expected. Route/UI mutations caught provider or account
mismatches, missing claimed provider, wrong RPC dispatch and invalid model input.

One new UI test initially failed to detect removal of the selection reset: the
old option was hidden while its React state survived. The corrected test switches
away and back, exposing the stale selection; the targeted mutation now fails and
the harmless control passes. The initial surviving receipt remains alongside the
corrected evidence. A first UI command ran at repository root and did not execute
tests; its corrected app-root run found one stale expected POST body, updated to
include the intentional explicit provider field. These are not browser evidence.

Remaining verification includes real navigation at desktop and 390px, usable
connection downloads, retained answers and approval handoff, interruptions,
revocation and console review. Claude generation will use installed native CLI
plus synthetic OAuth/local responses unless actual paid-extra-usage settings are
known. The local fixture is engineering transport evidence, not live model quality
or a zero-cost promise for users' provider accounts.


The first full QA/shuffled runs each found one release-ordering failure: this
checkpoint initially omitted the new migration from CHANGELOG Unreleased. The
13,766 other tests passed and 371 were skipped. The migration entry is now present;
the guard was unchanged. Both full runs will be repeated on the corrected source.
