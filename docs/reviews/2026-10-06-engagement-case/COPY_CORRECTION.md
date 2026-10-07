# Engagement control wording correction

The full local gate on `6bedf6b8` finds five additional occurrences of terms
covered by the existing planner-copy guard: two uses each of “input” and
“record,” and one of “workspace.” The guard and its baseline remain unchanged.

The preparation control now says “Prepare this source for analysis” and
“Preparation complete.” Cancellation confirmations use “saved,” and the API
settings link drops the redundant organizational label. The explanation still
states that preparation sends no contributions and approves no findings.
Cancellation still preserves earlier contributions, approvals and results,
permits cancellation during an uncertain save, and warns that an already-sent
provider call may incur charges.

The copy guard and three affected control suites pass 46 checks after these
changes. A harmless comment passes. Removing preparation actor verification or
letting a late creation reply erase confirmed cancellation still fails the
corresponding revised test. See [mutation evidence](copy-correction-mutations.json).
These component tests simulate HTTP. They do not establish rendered or native
acceptance. The failed full run remains a failed run; its remaining results and
the corrected candidate's release checks must be reported separately.

Nathaniel also reports that a separate agent will develop benefit-cost analysis
features in a fresh worktree. That agent owns that feature area. This session
owns engagement and integration. Its branch/path is pending at this checkpoint;
integration must account for it and coordinate any shared-main or demo update.
