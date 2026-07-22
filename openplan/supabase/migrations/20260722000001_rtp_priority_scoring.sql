-- RTP "why" engine: structured project prioritization scores.
--
-- Stores per-criterion ratings (0–3) for a project's role in an RTP cycle, so the
-- composite priority score + rationale (VMT/GHG/safety/equity/local-state-federal
-- alignment) replace free-text priority_rationale. Shape: { "<criterion_key>": 1..3 }.
-- Validated/normalized in app code (src/lib/rtp/priority-scoring.ts); JSONB keeps
-- the criteria taxonomy versionable without a schema migration per change.

ALTER TABLE project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS priority_scores JSONB NOT NULL DEFAULT '{}'::jsonb;
