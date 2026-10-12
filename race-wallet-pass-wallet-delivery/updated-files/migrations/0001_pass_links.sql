-- Existing deployments already add r2_key through ensureD1Bootstrap.
-- Run the bootstrap once via GET /api/stats before using this migration.
CREATE TABLE IF NOT EXISTS PassLinks (
  token_hash TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
);
