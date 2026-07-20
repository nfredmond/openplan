-- E6 (threaded replies) — public participants can reply to an APPROVED top-level
-- comment, adding deliberative back-and-forth to the engagement portal. A reply
-- is itself an engagement_item that flows through the SAME moderation queue, so a
-- human still approves it before it appears publicly. One level of nesting only
-- (a reply cannot itself be replied to) — enforced in the public submit route,
-- the only path that sets parent_item_id from untrusted input.

ALTER TABLE engagement_items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid
    REFERENCES engagement_items(id) ON DELETE CASCADE;

-- A comment can never be its own parent (cheap row-level defense-in-depth; the
-- one-level-nesting rule itself needs a cross-row check and lives in the route).
ALTER TABLE engagement_items
  DROP CONSTRAINT IF EXISTS engagement_items_parent_not_self;
ALTER TABLE engagement_items
  ADD CONSTRAINT engagement_items_parent_not_self
    CHECK (parent_item_id IS NULL OR parent_item_id <> id);

-- Index the reply edge for "load the replies to these parents" and FK cascades.
CREATE INDEX IF NOT EXISTS idx_engagement_items_parent
  ON engagement_items (parent_item_id)
  WHERE parent_item_id IS NOT NULL;

COMMENT ON COLUMN engagement_items.parent_item_id IS
  'E6 threaded replies: the approved top-level engagement_item this item replies to (NULL = top-level). One level of nesting only; enforced in the public submit route.';
