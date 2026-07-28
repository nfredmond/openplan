# Next-session plan — written 2026-07-27, after the four-wave vision push

**Audience:** the next Claude session (possibly Opus, with NO memory of today). Everything you
need is in this file, `CLAUDE.md` (binding — read it first), and the memory index. Do not
re-derive today's decisions; they are recorded here and in
`~/.claude/projects/-home-nathaniel-code-openplan/memory/vision-push-2026-07-27.md`.

## Where the product stands tonight

All four waves of the 2026-07-27 vision push are on `main` and pushed (tip `0e0a35d4`), qa:gate
green, ~3,590 tests / 479 files, working tree clean, no worktrees, no branches. In one day the
repo gained (~50 commits, migrations `20260727000003`–`000016`, all applied to the local DB):

- **Docs truth + self-host** (Wave D): commercial-era record deleted (Nathaniel's explicit
  decision — do NOT restore it), live docs truthful, SELF_HOSTING complete, forks safe.
- **Spine** (Wave A): run→project provenance, reports cite worker/county runs (typed
  `report_runs`), scenario model-run attachment, campaign-targeted reports that actually
  generate, nav registry driving all navs + the auth proxy, KB + Safety project wiring,
  invoicing substantiation, network-packages panel, Data Hub honesty, link cleanup triggers.
- **Money lane** (Wave B): reimbursement jurisdiction registry (Caltrans is ONE descriptor:
  `src/lib/invoicing/profiles/us-ca-lapm.ts`; a literal-guard test bans caltrans/lapm anywhere
  else in the invoicing domain), receivable invoicing end-to-end (clients → engagements w/ NTE →
  invoices → line items → PDF), staff/rate-tables/time-entries with pull-unbilled-time and a
  conditional-stamp guard against concurrent double-billing, deliverable budgets + pace math
  (`src/lib/projects/budget.ts` — refuses verdicts without user-entered data), award
  claimed-vs-paid progress.
- **AI lane** (Wave C): the spend limiter actually counts now (`recordAiUsageEvent`); the
  assistant chat has budgeted read tools + `propose_*` tools that NEVER mutate (the existing
  approval gate executes, with full-payload disclosure before Approve); grounded AI drafting
  inside reports (whitelisted sections) and RTP chapters with operator-accept gates and
  facts_hash staleness; grant application assembly (catalog-seeded or custom sections, per-
  section grounded drafting with fresh-facts revisions, attachment checklist, gated PDF export
  with a DRAFT stamp and true finalizer provenance); proposals as `pursuit_kind` on
  funding_opportunities (fee sections structurally never AI-drafted; team/credentials ground
  only on uploaded KB documents).

## Conventions that bit us today (obey them)

- `npm run qa:gate` from `openplan/` before EVERY push, and chain with `&&`, never `;` — a `;`
  once raced a failed gate's push through.
- Migrations: additive only, guarded `DO $$` constraint adds, `REVOKE ... FROM authenticated`
  before grants when claiming append-only (Supabase grants ALL to authenticated directly —
  revoking PUBLIC alone is theater; precedent `20260722000005`, `20260727000013/14`). Next free
  number: `20260728000001`. Apply locally with `npm exec -- supabase migration up` (never
  `db reset`).
- Next.js route files may export ONLY route handlers/config — a helper `export const` in a
  route file fails the build (vitest+tsc won't catch it; only the build leg does).
- Banned by `src/test/no-paid-tier-guard.test.ts` (run it before naming anything): billing
  paths, 402s, plan/quota/subscription symbols, and on visitor surfaces the words retainer /
  buyer / paid help / managed services / service[- ]lane / supervised-sales pairings.
- Supabase clients are untyped BY CONVENTION — verify every `.select()` column against
  migrations; a typo ships to runtime.
- Multi-agent execution pattern that worked all day: implement in isolated worktrees
  (`ln -s` the main checkout's `openplan/node_modules`), adversarially review each lane's diff,
  fix majors at landing, cherry-pick/ff onto main, gate, push, remove worktrees. Reviews caught
  11 real defects today — do not skip them.
- Check for concurrent sessions before mutating (memory: concurrent-sessions-check).
- Pre-existing debt to not confuse with your own breakage: 3 tsc errors
  (`explore-page-state.test.ts` ×1, `pilot-preflight-script.test.ts` ×2), 1 eslint warning
  (`ceqa-vmt-screen-body.tsx`), and `report-detail-page.test.tsx` can flake under full parallel
  load (passes in isolation).

## THE PLAN — in order

### Wave 1 (FIRST, before any new feature): pay the verification debt

Today produced ~50 commits with unit/route/build coverage but ZERO live-browser verification.
Never claim ahead of capability — prove the new surfaces in a real browser before building on
them. `npm run dev` (webpack) + seeded data (`npm run seed:nctc`, needs
`OPENPLAN_DEMO_USER_PASSWORD`), or the qa-harness local smokes where they exist.

Walk and FIX AS YOU GO (each fix = its own gated commit):
1. Invoicing: two-lane page → create client → engagement (NTE) → staff + rate table → time
   entries → pull unbilled time → invoice → send → PDF download → void (verify hours return to
   unbilled) → cash strip numbers.
2. Grants: opportunity → application init (catalog + custom) → section draft → flagged
   sentences → finalize (unedited-requires-exportable refusal) → attachments → export PDF
   (DRAFT stamp with missing attachments) → re-download. Then a proposal: pursuit-kind create →
   template seeding → fee section refuses AI → export cover variant.
3. Assistant: chat a lookup (read tools fire, chips render), ask it to create something
   (proposal card → full-payload disclosure → approve → action executes → /assistant-activity
   ledger), kill the network mid-stream (error frame renders, not an empty bubble).
4. Reports: project report → AI-draft a whitelisted section → accept → generate (labeled block,
   provenance) → change underlying data → regenerate (staleness flag). RTP chapter draft →
   insert into editor. Campaign-targeted report → generate.
5. Spine: explore page project picker → saved run carries project; model run cited in a report;
   scenario model-run attachment; budget panel + pace chips; safety ingest w/ project; KB
   project filter; nav registry surfaces + signed-out redirects on /safety, /invoicing, etc.
6. Migration reality: confirm `supabase migration up` is clean from scratch too (fresh shadow
   DB apply — `npm exec -- supabase db reset` on a THROWAWAY branch database only if the local
   stack's data doesn't matter; otherwise trust the incremental apply already done).

### Wave 2: bring-your-own keys + guided setup (Nathaniel's notes 2+3)

Goal: any team signs up and connects THEIR AI/map/census keys without touching env vars.
Design decision to make first (recommend a): per-workspace integration keys.

a. **Schema**: `workspace_integration_keys` (workspace_id, provider enum-by-CHECK
   ['anthropic','mapbox','census', …], key_ciphertext, key_last4, configured_by, timestamps;
   UNIQUE(workspace_id, provider)). Encrypt at rest (pgsodium/pgcrypto with a server-held
   secret env — design the key-wrapping honestly; NEVER return the plaintext to a browser;
   last4 only). RLS: owner/admin read-metadata/write; service-role reads plaintext server-side.
b. **Chokepoints**: thread workspace-key-with-env-fallback through the few central read sites
   (see the verified chokepoint list in the appendix below) — env stays authoritative for
   self-hosters; workspace keys override per tenant. `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is
   build-inlined for the browser — a per-workspace Mapbox token needs a runtime fetch path
   (e.g. a token endpoint the map shells call) — design deliberately, don't hack it.
c. **Model policy**: "state of the art only" — the model override envs stay, but per-workspace
   model selection (if offered) comes from a small allowlist of current Anthropic models; no
   local-model support.
d. **Setup wizard**: extend the EXISTING onboarding surfaces (see appendix) with a keys step:
   provider-by-provider walk-through (where to get the key, paste, LIVE VALIDATION probe per
   provider — a test call that proves the key works, honest failure copy), plus the
   deployment-health panel linking to it. Per-workspace keys make the wizard real (it saves);
   env-only providers get copy-paste instructions + a validate button, never a fake save.
e. **Spend guard interaction**: `usage_events` metering + `checkAiUsageRateLimit` must keep
   working when the key is the workspace's own (they meter abuse of the deployment, not cost —
   keep, but the refusal copy should distinguish "your key, your spend").

### Wave 3: team roles + engagement link UX (Nathaniel's notes 4+5)

a. **Viewer tier**: add `viewer` to the role enum (additive migration on the CHECK +
   role-matrix rows: read everything, write nothing; invitations UI gains role choice
   incl. viewer; verify every `canAccessWorkspaceAction` call site denies writes for viewer —
   the matrix is the single gate, so this is mostly matrix rows + tests). Member role
   management UI: change-role + remove-member actions per the appendix findings (build the
   missing API/UI if absent). Defer per-module edit flags unless trivially cheap — a
   role-per-module matrix is a real design, propose it separately if wanted.
b. **Engagement public/backend link UX** (his note asks how public + moderation coexist — IT
   ALREADY DOES: /engage/[shareToken] public portal vs authed /engagement/[campaignId]
   console). The work is DISCOVERABILITY + polish, per the appendix findings: a prominent
   "Public link" block on the campaign console (copy button, QR maybe, embed snippet, open-in-
   new-tab), enable/disable + regenerate token affordances if missing, and a plain-language
   explainer ("share this URL publicly; moderate from this console"). Also surface it in the
   campaign-create success state. Document in SELF_HOSTING/user-facing docs.

### Wave 4: recorded follow-ups (small, do in one batch)

- Dead `plan` column reads — DO THIS ONE FIRST, it is user-visible: the assistant still prints
  "Workspace plan: …" in its responses. Strip `workspaces.plan` + subscription_* from every
  remaining `.select()` and delete the assistant's plan lines (full list in appendix).
- Safety: re-ingest re-parents crashes to a new ingest id — project-scoped counts can mislead
  after re-ingest; default a re-ingest to the same project or reconcile counts.
- `project_spend_entries.deliverable_id` same-project integrity at the schema level (API
  enforces today) — workspace-match-CHECK pattern.
- RTP public share (`/plan/[shareToken]`): surface committed funding + fund sources per project
  (data already computed in `lib/projects/funding.ts` — was a deliberate omission, now wanted).
- Grants program catalog → data registry (the 15-program TS array is CA/federal-weighted;
  registry-ify like stage-gates/invoicing so other states add descriptors, not code).
- tsc/lint debt + the report-detail-page flake.
- Command Center vs Dashboard redundancy: fold or differentiate (low stakes, judgment call).

### Later (documented, not next): PM assignees/schedule/reminders (pairs with the viewer/roles
work), Data Hub executor, autonomous proposal v2 (boilerplate re-ingestion → org profile →
outcome feedback → approval-class change), hosted deployment (NATHANIEL ONLY: settle Vercel or
choose a host — until then the site truthfully claims self-host only).

## Appendix: verified current-state facts for Waves 2–4

(read-only verification sweep, 2026-07-27 — trust these over guesses)

**Engagement public link (Wave 3b).** The machinery EXISTS and is good:
`src/components/engagement/engagement-share-controls.tsx` has copy-link, open-portal, an
escaped embed snippet, a 4-check readiness checklist (`getPublicPortalReadiness` in
`src/lib/engagement/public-portal.ts:107`), and a Private/Staged/Live status banner. The
problems are placement and flow: it renders at the BOTTOM of the 1,275-line campaign page
(`engagement/[campaignId]/page.tsx:1250`, below an "Operator Actions" divider); the engagement
LIST page never selects `share_token` and shows no per-campaign portal status; token
regeneration is Remove→Save→Generate→Save (no one-click regenerate) and the token is a
free-text input minted client-side; `engagement.write` (which members hold) controls it.
Work: hoist a "Public link" block to the campaign header, portal-status chips on the list page,
one-click regenerate (server-minted), and share guidance. Consider whether token control should
be admin-gated once the viewer tier exists.

**Roles (Wave 3a).** No member management exists AT ALL: the only membership writes are the
`accept_workspace_invitation` RPC and the `handle_new_user` trigger — there is no members
list/PATCH/DELETE route and `workspace-team-panel.tsx` shows only invites + a member COUNT.
`WORKSPACE_ROLES = ["owner","admin","member"]` (`src/lib/auth/role-matrix.ts:1`);
`workspace_members.role` is bare TEXT with NO CHECK (adding `viewer` is code-only). The matrix
has 23 actions; only `workspace.configure` and `invoices.write` are owner/admin-restricted —
everything else allows member, so a `viewer` tier means flipping ~21 matrix rows to deny + THREE
hardcoded role checks outside the matrix (`api/workspaces/invitations/route.ts:17,203`,
`dashboard/page.tsx:80`) + the `canManage` prop threading in the geography/team panels.
Build order: members list + role-change + remove APIs/UI first, then the viewer tier.

**API keys (Wave 2).** No per-workspace secrets storage exists anywhere (no settings table, no
vault/pgsodium/pgcrypto in any migration; `data_connectors` describes auth modes but stores no
credentials). The deployment-health panel checks env PRESENCE only, no live probes
(`src/lib/config/deployment-health-facts.ts:40-59` is the single env-read point; panel is
owner/admin-only and silent-when-healthy — a persistent Keys panel is a deliberate behavior
change). Chokepoints by provider:
- Census: ONE module — `src/lib/data-sources/census-api-key.ts` (`withCensusApiKey`). Easiest.
- Anthropic: no shared factory; 9 uniform `anthropic(<model>)` construction sites + 8 presence
  gates (listed in the sweep). Introduce ONE `createAnthropic({apiKey})` wrapper and rewrite
  those sites; per-workspace key then threads through one function.
- Mapbox: HARDEST — 9 client components inline the build-time `NEXT_PUBLIC_*` env; a
  per-workspace token cannot be an env override, it needs a runtime token endpoint + prop/
  context plumbing to all 9 map consumers. Do it deliberately or defer Mapbox to env-only in
  the wizard's first cut.
The wizard's home: the dashboard config row (`dashboard/page.tsx:274-286`) already hosts
DeploymentHealthPanel + geography + team panels with the right audience/gating; extend THAT,
and reuse `evaluateDeploymentHealth`'s check shapes. Add LIVE validation probes per provider
(the panel has none today).

**Dead plan/subscription reads (Wave 4, first item — it is USER-VISIBLE).** The assistant
renders "Workspace plan: …" in its output today (`src/lib/assistant/respond.ts:859,915,1317`
via `context.ts:655,675`), fed by `src/lib/workspaces/current.ts:27` selecting
`plan, subscription_plan, subscription_status, billing_updated_at` (and `:227`
`workspacePlan: workspace.plan ?? "pilot"`). Other dead selects: `api/projects/route.ts:49`,
`(app)/projects/page.tsx:192`, `api/reports/[reportId]/generate/route.ts:582,1513`,
`api/workspaces/bootstrap/route.ts:152`, `(app)/reports/[reportId]/page.tsx:136`,
`(app)/projects/[projectId]/page.tsx:175`. Strip the columns from selects/types AND delete the
assistant's plan lines (a free product must not announce a plan). The DB columns stay (no-drop
rule).

**Onboarding surfaces (Wave 2d).** Four exist: the rare no-workspace `OnboardingWizard`
(`components/onboarding/onboarding-wizard.tsx`), the REAL first-run dashboard hero
(`dashboard/page.tsx:258-273`, emptiness-derived), `OnboardingGoals` (4 routing tiles, configures
nothing), and the dashboard config row (geography + team + health). Extend the config row and
optionally add a "Connect your keys" tile/goal; do not build a fifth parallel surface.
