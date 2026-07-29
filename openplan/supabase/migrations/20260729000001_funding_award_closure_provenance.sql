-- How a funding award became "fully spent" becomes part of the record.
--
-- THE DEFECT. `funding_awards.spending_status` stored the value `fully_spent`
-- and nothing else about it. POST /api/funding-awards accepted that value
-- verbatim from the create form, so an award could be born closed: no invoice
-- coverage check, no close-out milestone, no RTP posture rebuild — the entire
-- close-out contract skipped at birth. And because no PATCH route existed, a
-- `fully_spent` set by a mis-click was permanent, since the close-out route
-- answers `already_closed` to every subsequent attempt.
--
-- So two rows both reading `fully_spent` could mean opposite things: one earned,
-- with paid invoices covering the awarded amount to the dollar and a close-out
-- milestone filed on the project; the other merely asserted by whoever typed it.
-- Nothing in the schema could tell them apart, so neither could a planner, an
-- auditor, or a generated report. No application-layer change fixes that on its
-- own, because the distinction was never stored.
--
-- WHY NOT SIMPLY FORBID THE ASSERTED CLOSURE. A workspace adopting OpenPlan
-- carries history: awards that closed years ago, whose invoices were never in
-- this system and never will be. Refusing to let them say so would force the
-- lie the other way — either every historical award sits permanently "active",
-- or a planner invents invoice rows to satisfy a gate. Both are worse. The
-- asserted closure is legitimate; what was missing is that it must be SAID, and
-- must not be indistinguishable from an earned one afterwards.
--
-- WHAT IS ADDED
--
--   closure_basis   HOW the award became fully spent. A closed vocabulary,
--                   because these are code-level semantics rather than
--                   jurisdiction data — nothing here is specific to a country,
--                   an agency, or a funding programme.
--   closed_at       WHEN, and
--   closed_by       WHO — so an asserted closure has an author.
--   closure_note    the statement backing an asserted closure. Required for
--                   `recorded_on_import` by CHECK below: this is the one path
--                   that declares an award closed with no evidence, and the
--                   minimum price of that is a sentence saying on what basis.
--
--   reopened_at / reopened_by / reopen_reason
--                   A closed award can be re-opened, because "uncorrectable
--                   forever" is the defect this migration exists to end, and
--                   because awards genuinely do re-open in the world — a funder
--                   de-obligates, an audit claws money back, an amendment adds
--                   scope. The re-open is not free: it needs its own named
--                   intent at the API, its own audit event, and these three
--                   columns, which survive a later re-close. Without them,
--                   re-opening would erase the fact that a close-out ever
--                   happened, which is the same falsification in the other
--                   direction.
--
-- There is deliberately NO reopen counter. A count is the obvious thing to want
-- — "re-opened three times" is exactly the kind of pattern an auditor should
-- see — but PostgREST cannot express `SET n = n + 1`, so an application-level
-- counter is a read-modify-write that two simultaneous re-opens both write the
-- same value for. A number that is usually right is a worse artifact than no
-- number: it would be read as a fact and cited as one. The audit log holds the
-- sequence, and `reopened_at` holds the most recent one exactly.
--
-- THE THIRD BASIS VALUE, and why it is not a tidy default. Rows that are already
-- `fully_spent` when this migration runs were closed before OpenPlan recorded
-- how. Backfilling them as `earned_coverage` would manufacture provenance for
-- rows that may well have been asserted on the create form — precisely the
-- claim this migration exists to stop. `unrecorded_legacy` says the true thing:
-- this award is closed and the basis is not known. Application code never
-- writes it; only this backfill does.
--
-- No new RLS policy is needed. These are columns on an existing table, and
-- funding_awards already carries the permissive read/insert/update/delete
-- policies from 20260410000043 plus the RESTRICTIVE writer gates from
-- 20260728000006. A column inherits its table's policies, so the PATCH route
-- writes under the same permissive UPDATE policy the close-out route already
-- uses, constrained by the same viewer-denial gate.

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS closure_basis TEXT;

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS closure_note TEXT;

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

COMMENT ON COLUMN funding_awards.closure_basis IS
  'How this award became fully spent: earned_coverage (the close-out route verified paid invoices covering the awarded amount), recorded_on_import (a workspace asserted an already-closed historical award, with no coverage checked), or unrecorded_legacy (closed before OpenPlan recorded the basis). NULL on every award that is not fully spent.';
COMMENT ON COLUMN funding_awards.closure_note IS
  'The statement backing an asserted closure. Required when closure_basis is recorded_on_import; optional otherwise.';
COMMENT ON COLUMN funding_awards.reopened_at IS
  'When this award was most recently re-opened after being closed. Survives a later re-close, so a re-open can never erase the fact that a close-out happened.';

-- The vocabulary. Closed, and checked, because these three values are the whole
-- point: a fourth one appearing without a migration would mean some writer is
-- inventing provenance.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'funding_awards_closure_basis_known'
      AND conrelid = 'public.funding_awards'::regclass
  ) THEN
    ALTER TABLE funding_awards
      ADD CONSTRAINT funding_awards_closure_basis_known CHECK (
        closure_basis IS NULL
        OR closure_basis IN (
          'earned_coverage',
          'recorded_on_import',
          'unrecorded_legacy'
        )
      );
  END IF;
END $$;

-- Backfill BEFORE the coherence constraint, or every already-closed award would
-- fail it. Idempotent by the NULL test, so re-running this migration is safe.
UPDATE funding_awards
SET closure_basis = 'unrecorded_legacy'
WHERE spending_status = 'fully_spent'
  AND closure_basis IS NULL;

-- Coherence, as an equivalence rather than a one-way implication. Both halves
-- matter and each catches a different defect:
--
--   fully_spent WITHOUT a basis  — a writer that set the status and skipped the
--                                  provenance, which is exactly the hole being
--                                  closed here and would otherwise reopen the
--                                  moment someone adds a new update path.
--   a basis WITHOUT fully_spent  — a stale closure left behind by a re-open that
--                                  forgot to clear it, so a re-opened award
--                                  would still read as having been closed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'funding_awards_closure_basis_matches_status'
      AND conrelid = 'public.funding_awards'::regclass
  ) THEN
    ALTER TABLE funding_awards
      ADD CONSTRAINT funding_awards_closure_basis_matches_status CHECK (
        (spending_status = 'fully_spent') = (closure_basis IS NOT NULL)
      );
  END IF;
END $$;

-- An asserted closure with no statement is the thing this whole migration is
-- against: it would be indistinguishable, to a later reader, from a shrug. The
-- API requires the note, and this makes the requirement a property of the table
-- rather than of one route, so a second writer cannot quietly omit it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'funding_awards_imported_closure_states_its_basis'
      AND conrelid = 'public.funding_awards'::regclass
  ) THEN
    ALTER TABLE funding_awards
      ADD CONSTRAINT funding_awards_imported_closure_states_its_basis CHECK (
        closure_basis IS DISTINCT FROM 'recorded_on_import'
        OR (closure_note IS NOT NULL AND length(btrim(closure_note)) > 0)
      );
  END IF;
END $$;

-- A recorded re-open must have both a date and a non-empty reason. Undoing a
-- compliance sign-off without saying why would leave "this was re-opened" as an
-- assertion with no account behind it — the same unaccountable state the closure
-- columns exist to prevent, pointing the other way. Either both are present or
-- neither is; `reopened_by` may legitimately be NULL, because the FK clears it
-- when the user account is deleted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'funding_awards_reopen_is_accounted_for'
      AND conrelid = 'public.funding_awards'::regclass
  ) THEN
    ALTER TABLE funding_awards
      ADD CONSTRAINT funding_awards_reopen_is_accounted_for CHECK (
        (reopened_at IS NULL AND reopen_reason IS NULL)
        OR (
          reopened_at IS NOT NULL
          AND reopen_reason IS NOT NULL
          AND length(btrim(reopen_reason)) > 0
        )
      );
  END IF;
END $$;
