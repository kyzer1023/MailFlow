-- Flow names identify campaign history, so each member needs one
-- case-insensitively unique name. Preserve the oldest duplicate unchanged and
-- give later duplicates a deterministic, collision-resistant suffix before
-- adding the database constraint.
UPDATE flows
SET name = TRIM(name)
WHERE name <> TRIM(name);

CREATE TABLE flow_name_duplicates_migration AS
  SELECT
    id,
    owner_user_id,
    name AS original_name,
    ROW_NUMBER() OVER (
      PARTITION BY owner_user_id, name COLLATE NOCASE
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_position
  FROM flows
  WHERE state = 'active';

-- Move duplicates out of the user-visible namespace before assigning their
-- friendly numbered names. This also avoids collisions between groups while
-- the migration is in progress.
UPDATE flows
SET name = '__mailflow_duplicate__' || id
WHERE id IN (
  SELECT id
  FROM flow_name_duplicates_migration
  WHERE duplicate_position > 1
);

UPDATE flows
SET name = (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM flows AS existing
      WHERE existing.owner_user_id = duplicate.owner_user_id
        AND existing.id <> duplicate.id
        AND existing.name = SUBSTR(duplicate.original_name, 1, 100) || ' (' || duplicate.duplicate_position || ')' COLLATE NOCASE
    )
      THEN SUBSTR(duplicate.original_name, 1, 70) || ' (' || duplicate.id || ')'
      ELSE SUBSTR(duplicate.original_name, 1, 100) || ' (' || duplicate.duplicate_position || ')'
  END
  FROM flow_name_duplicates_migration AS duplicate
  WHERE duplicate.id = flows.id
)
WHERE id IN (
  SELECT id
  FROM flow_name_duplicates_migration
  WHERE duplicate_position > 1
);

DROP TABLE flow_name_duplicates_migration;

CREATE UNIQUE INDEX IF NOT EXISTS idx_flows_owner_name_unique
ON flows(owner_user_id, name COLLATE NOCASE)
WHERE state = 'active';
