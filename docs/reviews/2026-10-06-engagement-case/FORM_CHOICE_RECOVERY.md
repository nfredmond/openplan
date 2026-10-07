# Unsent analysis choices across access revalidation

The identified `90858445` browser pass found that returning focus to OpenPlan
unmounts the private source inspector while access is checked. This also erased
an unsent API and model choice. The request itself remains recoverable once its
exact command has been retained. [The original browser record](BROWSER_908.md)
keeps that distinction.

This correction keeps an unsent choice in the source panel's scoped memory. It
binds the choice to the account, workspace, campaign, source and source hash.
Revalidation still removes private controls until the source read succeeds.
Provider metadata is read again before saving becomes available. A changed or
revoked provider revision cannot silently replace the selected revision.

A temporary failed read keeps the choice for an explicit fresh read. Current
source or provider access denial clears it. Account changes clear the source
owner's choice map. A stale denied read cannot erase a choice after a newer
successful read. Once an exact request is retained, its existing command-recovery
record takes precedence and the unsent choice is retired. No choice restoration
submits a request, grants execution permission or calls a provider.

The change uses the existing source owner and creation panel. It adds no storage
schema, endpoint or new provider connection. Memory survives focus revalidation
within this page. An unsent choice is not promised across full page navigation or
browser closure; exact submitted commands retain their existing durable recovery.

## Verification boundary

On October 6, 2026 Pacific time, the isolated
`work/engagement-form-recovery-20261006` checkout passes 34 focused checks across
`engagement-synthesis-generation-create-panel.test.tsx` and
`engagement-synthesis-source-panel.test.tsx`. The integration checks mount the real
source and creation components, remove the inspector during a pending focus read,
and challenge success, access denial, temporary failure and a stale denial.

The mutation record includes a harmless comment control and targeted removals of
scope separation, parent retention, source/provider denial clearing, revision
checking, submitted-command precedence and stale-response protection. Each broken
behavior must fail for its stated reason; syntax or setup failures do not count.

These are synthetic React and fetch checks. They do not establish native browser
focus behavior, database authorization, accessibility conformance or usefulness
for practicing planners. Production build, desktop and 390px browser acceptance,
and final combined GitHub checks remain open for this correction. The full QA
running in the separate execution checkout remains bound to `c8177f05`; these
files do not change that checkout or extend its evidence to this correction.
