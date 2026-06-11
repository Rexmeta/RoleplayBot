-- Step 1: Reassign turn_index to a dense sequential number (0, 1, 2, …) per
-- persona_run_id so that the new (persona_run_id, turn_index) unique index can
-- be created without violations.
--
-- Under the previous scheme the unique key was (persona_run_id, turn_index, sender),
-- which allowed e.g. an AI row and a user row to share the same turn_index value.
-- The new key omits sender, so we must renumber before adding the constraint.
--
-- Rows are ordered by (turn_index, created_at, id) to preserve the original
-- relative ordering as faithfully as possible.
WITH ranked AS (
  SELECT id,
         (ROW_NUMBER() OVER (
           PARTITION BY persona_run_id
           ORDER BY turn_index, created_at, id
         ) - 1)::integer AS new_turn_index
  FROM chat_messages
)
UPDATE chat_messages
SET turn_index = ranked.new_turn_index
FROM ranked
WHERE chat_messages.id = ranked.id;

-- Step 2: Drop the old 3-column unique index.
DROP INDEX IF EXISTS "idx_chat_messages_upsert_key";

-- Step 3: Create the new 2-column unique index.
CREATE UNIQUE INDEX "idx_chat_messages_upsert_key"
  ON "chat_messages" ("persona_run_id", "turn_index");
