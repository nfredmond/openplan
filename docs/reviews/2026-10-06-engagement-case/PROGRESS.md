# Complete engagement case development

Nathaniel directed continued development through the full v1 contract on October
6. This work continues the October product-direction review and roadmap M9b.
It does not narrow v1 or declare a new release. The implementation checkout is
`engagement-complete-case-20261006`, based on merged main `b028d0e4`.

## Preparation controls

Staff can inspect preparation from a saved generation request. The panel reads
the native job state, checks request, actor, intent hash and stage, and offers
explicit enqueue or observed-attempt retry to the original requester. Another
staff account can inspect status. Preparation does not authorize provider
execution, approve a finding or publish a contribution.

The panel uses the existing recovery module. It retains and reads back the exact
command before sending, recovers it after remount, and preserves unreadable
originals before clearing the active recovery slot. Failed storage prevents a
network write. History refresh closes the preparation inspector before native
revalidation. Denied access clears its private state and notifies the source view.

Focused component and recovery checks pass: 3 files, 64 tests. The harmless
comment mutation passes. Removing actor verification, enabling another staff
account's queue button, and retaining selection across history refresh each
fail their corresponding component test. These checks use simulated HTTP
responses. They do not prove native authorization, worker operation, rendered
usability or practitioner acceptance.

Browser and release checks remain pending at this checkpoint. Request creation,
cancellation, explicit provider authorization, and the complete case through
proposal import, response, decision and usable artifacts remain unfinished.
The roadmap remains the only active queue.
