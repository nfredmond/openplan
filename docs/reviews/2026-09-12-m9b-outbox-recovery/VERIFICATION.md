# v0.56.1 email persistence and confirmation retry

The source fix is bae56101, merged with published v0.56.0 in bce8c31a. Browser
acceptance ran on b158f28f in the isolated recovery checkout. Only documentation
was dirty during those journeys. Version and release metadata changed afterward;
application behavior did not. Full QA, shuffled tests and live RLS are pending.

## What the checks establish

The real email helper previously attempted transport despite a refused outbox
insert. The retained reproduction intercepts the transport; no email was sent.
Focused tests now cover returned errors, absent/malformed identities, the selected
identity projection, persistence-before-transport ordering, broadcast counts and
staff/public notices. Failed public confirmations keep the address and retry form.
The retained checks cover 115 tests across nine files, TypeScript and changed-file
lint. The mutation runner observed one harmless survivor and ten targeted failures.
All mutations were restored. Initial harness failures remain recorded.

The browser ran installed Chrome through the repository Playwright dependency,
using isolated temporary contexts. which-openplan.sh confirmed the development
listener served /home/nathaniel/.local/state/openplan/engagement-write-recovery-2026-09-12/openplan
on port 3256. Proxy 3219 forwarded to the named disposable database
openplan-restore-target-2026091050 on API 29821. No demo or unrelated stack was used.

Both 1440px and 390px journeys began at sign-in and navigated through Engagement,
created a synthetic campaign using the wizard, published its public access using
Setup, and opened the actual public portal and details page. No subscription was
hand-seeded. The subscriber address uses example.invalid.

For each campaign the proxy refused one confirmation outbox insert. The browser
received HTTP 201 because the subscription itself was saved, saw the preparation
failure, and retained the address and enabled retry control. Database readback
showed exactly one pending subscription and no outbox row. Keyboard retry after
restoring writes retained the same subscription and saved exactly one confirmation.
The real confirmation endpoint then confirmed that subscription through the link
read from the retained local message. This simulates receipt of the message;
external email delivery was not tested.

Staff created and published a response through the same campaign UI. With another
outbox refusal, publication succeeded, the response history retained created and
published copies, and the notice reported one unsaved email and no attempted
delivery. It did not claim there were no confirmed subscribers. The outbox still
contained only the confirmation row. Both refusal counters were asserted.

The email provider was replaced at the process fetch boundary by a local stub
using a dummy key. It accepts only example.invalid recipients and never forwards
provider calls. A synthetic control succeeded and a non-test recipient was refused.
Each browser journey asserted zero transport calls after the first refusal,
exactly one after successful retry, and no additional call after the staff refusal.
The outbox's sent state in this fixture means synthetic transport acceptance only.

Screenshots in browser/ were opened and inspected. At both widths the failure
messages and controls were readable. Staff document width stayed within viewport
width, and final runs recorded no console warnings/errors, request failures or
page exceptions. Keyboard use covered navigation, signup/retry and staff publish.
The private generated confirmation URL uses localhost:3256, which is the same
identified local listener; the runner follows the retained link unchanged.

## Runner corrections and limits

Initial runs found incorrect runner assumptions, not accepted journeys: duplicate
Generate link controls; activation switching the default tab to Responses; trying
signup with email disabled, when the product correctly hides it; acting before
the public controls hydrated; a confirmation success-text mismatch; and assuming
the generated URL used 127.0.0.1 instead of localhost. The runner now waits for
saved setup steps and enabled public controls, returns through Setup, and follows
the observed link. One launch also ended with Chrome ERR_NETWORK_CHANGED before
the workflow. Earlier captures and diagnostics remain in the private evidence
directory. Final independent campaigns completed at both widths.

The local stub cannot establish provider acceptance or mailbox delivery. Focused
mocks cannot establish database permissions; separate RLS tests cover isolation.
These journeys do not establish exactly-once mail delivery, durable broadcast
replay, completeness of subscriber reads, correction reasons, prevention of stale
response writes, translation custody, or measured participant/agency usefulness.
No migration, RLS policy, geography, pending reminder constraint or scientific
claim changed. M9b and the full v1 contract remain unfinished.
