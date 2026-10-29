import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { PARTICIPANT_SETTINGS_SCHEMA, PARTICIPANT_EMAIL_TRIGGERS } from '../worker/participantSettings.ts';

const migration = readFileSync(new URL('../migrations/0005_shared_participant_emails.sql', import.meta.url), 'utf8');
function legacyDatabase(appendedR2Column = false) {
  const db = new DatabaseSync(':memory:');
  let schema = readFileSync(new URL('./fixtures/pre-shared-emails.sql', import.meta.url), 'utf8');
  if (appendedR2Column) {
  schema = schema.replace(/^[ \t]*r2_key TEXT,[ \t]*\r?\n/m, '');
}
  db.exec(schema);
  if (appendedR2Column) db.exec('ALTER TABLE Passes ADD COLUMN r2_key TEXT');
  // Also cover the case where the new Worker ran before the migration.
  db.exec(PARTICIPANT_SETTINGS_SCHEMA + ';' + PARTICIPANT_EMAIL_TRIGGERS.join(';'));
  db.exec(`INSERT INTO Organizations(id,name) VALUES ('org','3F');
    INSERT INTO Templates(id,org_id,name,schema_definition) VALUES ('tpl','org','Pass','{}');
    INSERT INTO Races(id,org_id,template_id,name,field_mapping) VALUES ('race','org','tpl','Event','{}');
    INSERT INTO Runners(id,race_id,email,first_name,last_name,dynamic_data) VALUES ('runner','race','family@example.com','Alex','One','{"bib":101}');
    INSERT INTO Passes(id,runner_id,status,walletwallet_pass_id,apple_pass_base64,r2_key,google_save_url) VALUES ('pass','runner','issued','ww-existing','original-package','passes/runner/pass.pkpass','https://pay.google.com/gp/v/save/test');
    INSERT INTO PassLinks(token_hash,runner_id) VALUES ('secure-token-hash','runner');
    INSERT INTO ImportJobs(id,batch_id,runner_id,state,attempts,last_error) VALUES ('job','batch','runner','retrying',2,'Transient failure');
    INSERT INTO EmailTemplates(id,name,subject,message) VALUES ('email','Invitation','Hello','Welcome');
    INSERT INTO EventEmailTemplates(race_id,email_template_id) VALUES ('race','email');`);
  return db;
}

test('shared-email migration preserves all athlete/pass/link/import data with foreign keys enabled', () => {
  const db = legacyDatabase();
  const tables = ['Runners', 'Passes', 'PassLinks', 'ImportJobs', 'Races', 'Templates', 'EmailTemplates', 'EventEmailTemplates'];
  const before = tables.map(name => db.prepare(`SELECT * FROM ${name}`).all());
  db.exec('BEGIN'); db.exec(migration); db.exec('COMMIT');
  assert.deepEqual(tables.map(name => db.prepare(`SELECT * FROM ${name}`).all()), before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare('INSERT INTO Runners(id,race_id,email,first_name,last_name) VALUES (?,?,?,?,?)').run('other','race',' FAMILY@example.com ','Sam','Two'), /Duplicate email/);
  db.exec("INSERT INTO EventParticipantSettings(race_id,allow_duplicate_emails) VALUES ('race',1)");
  db.prepare('INSERT INTO Runners(id,race_id,email,first_name,last_name) VALUES (?,?,?,?,?)').run('other','race','family@example.com','Sam','Two');
  assert.throws(() => db.exec("UPDATE EventParticipantSettings SET allow_duplicate_emails = 0 WHERE race_id = 'race'"), /Cannot disable/);
  db.exec("DELETE FROM Races WHERE id = 'race'");
  for (const table of ['Runners','Passes','PassLinks','ImportJobs','EventParticipantSettings','EventEmailTemplates']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Templates').get()!.n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM EmailTemplates').get()!.n, 1);
});

test('a failed migration transaction restores all old data and constraints', () => {
  const db = legacyDatabase(), before = db.prepare('SELECT * FROM Passes').all();
  db.exec('BEGIN');
  assert.throws(() => db.exec(migration + '; INSERT INTO missing_table VALUES (1);'));
  db.exec('ROLLBACK');
  assert.deepEqual(db.prepare('SELECT * FROM Passes').all(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PassLinks').get()!.n, 1);
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'Runners'").get()!.sql!.toString().includes('UNIQUE(race_id, email)'));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration copies named columns correctly when bootstrap appended r2_key after older columns', () => {
  const db = legacyDatabase(true);
  const before = db.prepare('SELECT * FROM Passes').get();
  db.exec('BEGIN'); db.exec(migration); db.exec('COMMIT');
  assert.deepEqual(db.prepare('SELECT * FROM Passes').get(), before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
