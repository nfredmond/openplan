# Wave 3 — team roles and the public engagement link (2026-07-28)

The last wave of the recorded queue (`docs/ops/2026-07-27-next-session-plan.md`). Two lanes:
workspace membership finally became manageable and gained a read-only tier, and the public
engagement portal link stopped being buried at the bottom of a 1,275-line console.

Everything below was built, adversarially reviewed (3 lenses, every finding independently
verified), fixed, and gated before landing.

## What shipped

**Member management — the feature that did not exist.** Until now the only ways to change who
belongs to a workspace were the `accept_workspace_invitation` RPC and the `handle_new_user`
signup trigger; the team panel showed pending invitations and a member *count*. There is now a
`/api/workspaces/members` route (GET/PATCH/DELETE) and a real roster in the team panel: change
a member's role, remove someone, or leave yourself.

The authority rules, each with a test:
- Listing and managing members is owner/admin work (the invitations precedent — team data is
  operator information). A member or viewer gets 403; a non-member gets 404, so nobody learns
  a workspace exists by probing.
- Only an **owner** may grant or revoke the owner role, or touch another owner. Admins manage
  members, viewers, and other admins.
- **The last owner can never be demoted or removed** — including by themselves.
- Self-removal (leaving) is open to every role except the last owner.

**The viewer tier.** `WORKSPACE_ROLES` gained `viewer`: present on every read action in the
role matrix, absent from all 13 mutating ones. Invitations can be sent as viewer. The DB layer
needed widening too — both the `workspace_invitations.role` CHECK and the allowlist inside
`accept_workspace_invitation` predated the tier (migration `20260728000003`), and that
migration also generalized acceptance so it can never *downgrade* an existing membership.

**Engagement public link.** A compact "Public link" block now sits in the campaign console
header: portal status chip, the URL with copy and open-in-new-tab, and one plain sentence —
"Share this URL publicly; every submission lands in this console's moderation queue." The full
share controls stay below for detail work. The campaigns list shows a Private/Staged/Live chip
per campaign (it never selected `share_token` before). Regenerating a link is now one click
against a dedicated endpoint that mints a 28-character token **server-side** and saves it in
one step; the free-text, client-minted token input is gone.

## What the review caught, and what it means

Three majors, all confirmed against the running system rather than by reading:

1. **Member management was dead on arrival.** The roster read through the RLS client, and the
   only SELECT policy on `workspace_members` is `members_read_own`
   (`user_id = auth.uid()`, migration `20260316000024`, which replaced a recursive policy). An
   owner would have seen a team of exactly one — no teammate to promote, none to remove.
   Proven live before the fix: the RLS path returned 1 row where the service-role path returned
   2. The same truncation had been silently capping the invitation panel's member count at 1.
   Both reads now go through the service role, *after* the owner/admin guard authorizes them,
   and the test mocks throw if either ever reverts to the RLS client.

2. **Last-owner protection was check-then-act.** The route counted owners and then issued a
   separate, unconditional write. Two owners demoting each other in the same instant would each
   see two owners and both writes would land, leaving a workspace with **zero** owners — and
   that state is unrecoverable in-app, because only an owner can appoint an owner and
   invitations refuse the owner role. A free, self-serve product must not have a lockout whose
   repair needs operator SQL.

   The guarantee moved into the database (`20260728000004`): a `SECURITY DEFINER` trigger on
   UPDATE and DELETE that locks the parent `workspaces` row before counting, which serializes
   every owner-losing change for that workspace. The second transaction then counts *after* the
   first commits, sees zero owners remaining, and is refused with SQLSTATE `OP409`, which the
   route reports as the same 409 the caller would otherwise have seen. `SECURITY DEFINER` is
   load-bearing, not incidental: under the caller's own RLS the count would read zero other
   owners and refuse a *legitimate* demotion.

   Verified in psql: demoting one of two owners succeeds, demoting the last is refused,
   deleting the last is refused, and deleting a whole workspace still cascades cleanly.
   Provisioning is unaffected — both seed paths upsert `role: 'owner'`, which the trigger's
   WHEN clause excludes — and invitation acceptance never downgrades an owner, so it cannot
   trip the trigger either.

3. **The viewer tier was a promise the API did not keep.** Every workspace-content RLS write
   policy is role-blind (`workspace_id IN (SELECT workspace_id FROM workspace_members WHERE
   user_id = auth.uid())`), so any route that authorized writes purely by row visibility let a
   viewer mutate content while the UI promised "Read everything, change nothing."

   Twelve routes were gated: county runs (create, manifest, scaffold, validate-refresh,
   enqueue), the network-package family, and project records. Three of the network-package
   child routes had **no `auth.getUser()` call at all**. The scaffold gate deliberately sits
   before the on-disk CSV write, not just before the row update.

   The systemic fix is `src/test/workspace-write-role-gate-guard.test.ts`: it scans every
   `src/app/api/**/route.ts` with a mutating export that touches a workspace, and fails unless
   the file carries a recognized gate or appears in a commented allowlist. It also proves its
   own allowlist stays honest, and that each "recognized gate" really performs a role check —
   so a future helper that only verifies membership cannot be quietly added to the list.
   Independently negative-tested: stripping the gate from one route fails the guard by name.

Minors fixed alongside: the campaign PATCH route no longer accepts a caller-supplied share
token (it answers 400 naming the mint endpoint, rather than silently ignoring stated intent)
and no longer writes a token value into an audit log; the team panel stops trusting local state
after a self-removal or self-demotion and refreshes into the caller's real role; and the
invitation role CHECK was narrowed to what the product actually permits — it had allowed
`owner` since 2026-04-24 although no code path could create one.

## Boundaries worth remembering

- The role matrix remains the single authorization gate **where it reaches**. It does not reach
  routes that authorize by RLS visibility, which is exactly why the guard test exists.
- New gates use `isReadOnlyWorkspaceRole` rather than `canAccessWorkspaceAction` on purpose:
  `workspace_members.role` is bare TEXT with no CHECK, and the matrix denies unknown role
  strings. Denying an existing member with a legacy role would be worse than the bug being
  fixed.
- `members_read_own` is unchanged. Widening it was the alternative fix and was not taken — a
  recursive policy on this table caused an outage once already (`20260316000024`), and the
  service-role read behind an owner/admin guard is the narrower change.
