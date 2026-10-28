CREATE TABLE IF NOT EXISTS EmailTemplateDesigns (
  email_template_id TEXT PRIMARY KEY,
  design_json TEXT NOT NULL,
  FOREIGN KEY (email_template_id) REFERENCES EmailTemplates(id) ON DELETE CASCADE
);
