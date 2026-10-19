-- Purpose: Adds and populates the microorganism dimension lookup table for normalized organism labels.
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS microorganism_dim (
  microorganism_id INTEGER PRIMARY KEY AUTOINCREMENT,
  microorganism_name TEXT NOT NULL UNIQUE
);

-- populate dimension members from existing distinct names
INSERT OR IGNORE INTO microorganism_dim (microorganism_name)
SELECT DISTINCT TRIM(microorganisms) FROM microbes
WHERE microorganisms IS NOT NULL AND TRIM(microorganisms) <> '';

COMMIT;