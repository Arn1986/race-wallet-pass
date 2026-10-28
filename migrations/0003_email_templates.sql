CREATE TABLE IF NOT EXISTS EmailTemplates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS EventEmailTemplates (
  race_id TEXT PRIMARY KEY, email_template_id TEXT NOT NULL,
  FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE,
  FOREIGN KEY (email_template_id) REFERENCES EmailTemplates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_email_template ON EventEmailTemplates(email_template_id);
