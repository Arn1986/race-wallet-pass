-- Cloudflare D1 Database Schema
-- Enable Foreign Key constraints
PRAGMA foreign_keys = ON;

-- 1. Organizations (Multi-Tenant Scope)
CREATE TABLE IF NOT EXISTS Organizations (
    id TEXT PRIMARY KEY, -- UUID v4
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Templates (Design Specs & Layout Mappings)
CREATE TABLE IF NOT EXISTS Templates (
    id TEXT PRIMARY KEY, -- UUID v4
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    background_color TEXT DEFAULT '#111827',
    text_color TEXT DEFAULT '#FFFFFF',
    label_color TEXT DEFAULT '#9CA3AF',
    logo_image_url TEXT,       -- Cloudflare R2 Public URL
    background_image_url TEXT, -- Cloudflare R2 Public URL
    strip_image_url TEXT,      -- Cloudflare R2 Public URL
    schema_definition TEXT NOT NULL, -- JSON string defining expected fields
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES Organizations(id) ON DELETE CASCADE
);

-- 3. Races / Events
CREATE TABLE IF NOT EXISTS Races (
    id TEXT PRIMARY KEY, -- UUID v4
    org_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    name TEXT NOT NULL,
    event_date DATETIME,
    location TEXT,
    field_mapping TEXT NOT NULL, -- JSON mapping CSV columns -> Template fields
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES Organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES Templates(id)
);

-- 4. Runners / Participants
CREATE TABLE IF NOT EXISTS Runners (
    id TEXT PRIMARY KEY, -- UUID v4
    race_id TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dynamic_data TEXT, -- JSON blob (e.g. {"bib": "1042", "category": "42K", "wave": "A"})
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE
);

-- 5. Wallet Passes
CREATE TABLE IF NOT EXISTS Passes (
    id TEXT PRIMARY KEY, -- UUID v4
    runner_id TEXT NOT NULL UNIQUE,
    walletwallet_pass_id TEXT UNIQUE,
    google_save_url TEXT,
    share_url TEXT,
    apple_pass_base64 TEXT,
    r2_key TEXT,
    status TEXT CHECK(status IN ('pending', 'issued', 'revoked', 'failed')) DEFAULT 'pending',
    installed_apple BOOLEAN DEFAULT 0,
    installed_google BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_races_org ON Races(org_id);
CREATE INDEX IF NOT EXISTS idx_runners_race ON Runners(race_id);
CREATE INDEX IF NOT EXISTS idx_runners_email ON Runners(email);
CREATE INDEX IF NOT EXISTS idx_passes_status ON Passes(status);

-- 6. System Settings (In-App configuration for Resend API key, Email From, Domains)
CREATE TABLE IF NOT EXISTS SystemSettings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Personal bearer links; keep raw tokens only in delivered emails, not in D1.
CREATE TABLE IF NOT EXISTS PassLinks (
    token_hash TEXT PRIMARY KEY,
    runner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
);

-- Bulk import progress and recoverable queue failures.
CREATE TABLE IF NOT EXISTS ImportJobs (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, runner_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_batch ON ImportJobs(batch_id);

-- Reusable event email invitations.
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

CREATE TABLE IF NOT EXISTS EmailTemplateDesigns (
  email_template_id TEXT PRIMARY KEY,
  design_json TEXT NOT NULL,
  FOREIGN KEY (email_template_id) REFERENCES EmailTemplates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS EventParticipantSettings (
  race_id TEXT PRIMARY KEY,
  allow_duplicate_emails INTEGER NOT NULL DEFAULT 0 CHECK(allow_duplicate_emails IN (0,1)),
  FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS runners_email_insert BEFORE INSERT ON Runners
    WHEN COALESCE((SELECT allow_duplicate_emails FROM EventParticipantSettings WHERE race_id = NEW.race_id),0) = 0
      AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email)) AND id <> NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Duplicate email is not allowed for this event'); END;

CREATE TRIGGER IF NOT EXISTS runners_email_update BEFORE UPDATE OF race_id,email ON Runners
    WHEN COALESCE((SELECT allow_duplicate_emails FROM EventParticipantSettings WHERE race_id = NEW.race_id),0) = 0
      AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email)) AND id <> NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Duplicate email is not allowed for this event'); END;

CREATE TRIGGER IF NOT EXISTS event_email_insert BEFORE INSERT ON EventParticipantSettings
    WHEN NEW.allow_duplicate_emails = 0 AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1)
    BEGIN SELECT RAISE(ABORT, 'Cannot disable shared emails while duplicates exist'); END;

CREATE TRIGGER IF NOT EXISTS event_email_update BEFORE UPDATE OF allow_duplicate_emails ON EventParticipantSettings
    WHEN NEW.allow_duplicate_emails = 0 AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1)
    BEGIN SELECT RAISE(ABORT, 'Cannot disable shared emails while duplicates exist'); END;
