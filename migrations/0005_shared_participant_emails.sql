-- Run with writers and queue consumers paused. Back up D1 first.
-- Rebuild dependent tables as well, so DROP Runners cannot cascade-delete their data.
CREATE TABLE IF NOT EXISTS EventParticipantSettings (
  race_id TEXT PRIMARY KEY,
  allow_duplicate_emails INTEGER NOT NULL DEFAULT 0 CHECK(allow_duplicate_emails IN (0,1)),
  FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE
);


CREATE TABLE _shared_Runners (
    id TEXT PRIMARY KEY, -- UUID v4
    race_id TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dynamic_data TEXT, -- JSON blob (e.g. {"bib": "1042", "category": "42K", "wave": "A"})
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE
);

INSERT INTO _shared_Runners (id, race_id, email, first_name, last_name, dynamic_data, created_at)
SELECT id, race_id, email, first_name, last_name, dynamic_data, created_at FROM Runners;

CREATE TABLE _shared_Passes (
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
    FOREIGN KEY (runner_id) REFERENCES _shared_Runners(id) ON DELETE CASCADE
);

INSERT INTO _shared_Passes (id, runner_id, walletwallet_pass_id, google_save_url, share_url, apple_pass_base64, r2_key, status, installed_apple, installed_google, created_at, updated_at)
SELECT id, runner_id, walletwallet_pass_id, google_save_url, share_url, apple_pass_base64, r2_key, status, installed_apple, installed_google, created_at, updated_at FROM Passes;

CREATE TABLE _shared_PassLinks (
    token_hash TEXT PRIMARY KEY,
    runner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (runner_id) REFERENCES _shared_Runners(id) ON DELETE CASCADE
);

INSERT INTO _shared_PassLinks (token_hash, runner_id, created_at)
SELECT token_hash, runner_id, created_at FROM PassLinks;

CREATE TABLE _shared_ImportJobs (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, runner_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (runner_id) REFERENCES _shared_Runners(id) ON DELETE CASCADE
);

INSERT INTO _shared_ImportJobs (id, batch_id, runner_id, state, attempts, last_error, created_at, updated_at)
SELECT id, batch_id, runner_id, state, attempts, last_error, created_at, updated_at FROM ImportJobs;

DROP TRIGGER IF EXISTS event_email_insert;

DROP TRIGGER IF EXISTS event_email_update;

DROP TABLE Passes;

DROP TABLE PassLinks;

DROP TABLE ImportJobs;

DROP TABLE Runners;

ALTER TABLE _shared_Runners RENAME TO Runners;

ALTER TABLE _shared_Passes RENAME TO Passes;

ALTER TABLE _shared_PassLinks RENAME TO PassLinks;

ALTER TABLE _shared_ImportJobs RENAME TO ImportJobs;

CREATE INDEX IF NOT EXISTS idx_runners_race ON Runners(race_id);

CREATE INDEX IF NOT EXISTS idx_runners_email ON Runners(email);

CREATE INDEX IF NOT EXISTS idx_passes_status ON Passes(status);

CREATE INDEX IF NOT EXISTS idx_import_jobs_batch ON ImportJobs(batch_id);

CREATE INDEX IF NOT EXISTS idx_runners_event_email ON Runners(race_id,LOWER(TRIM(email)));

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
