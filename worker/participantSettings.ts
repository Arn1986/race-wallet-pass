export const PARTICIPANT_SETTINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS EventParticipantSettings (
  race_id TEXT PRIMARY KEY,
  allow_duplicate_emails INTEGER NOT NULL DEFAULT 0 CHECK(allow_duplicate_emails IN (0,1)),
  FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE
)`;
export const PARTICIPANT_EMAIL_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS runners_email_insert BEFORE INSERT ON Runners
    WHEN COALESCE((SELECT allow_duplicate_emails FROM EventParticipantSettings WHERE race_id = NEW.race_id),0) = 0
      AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email)) AND id <> NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Duplicate email is not allowed for this event'); END`,
  `CREATE TRIGGER IF NOT EXISTS runners_email_update BEFORE UPDATE OF race_id,email ON Runners
    WHEN COALESCE((SELECT allow_duplicate_emails FROM EventParticipantSettings WHERE race_id = NEW.race_id),0) = 0
      AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email)) AND id <> NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Duplicate email is not allowed for this event'); END`,
  ...['INSERT', 'UPDATE OF allow_duplicate_emails'].map(operation => `CREATE TRIGGER IF NOT EXISTS event_email_${operation === 'INSERT' ? 'insert' : 'update'} BEFORE ${operation} ON EventParticipantSettings
    WHEN NEW.allow_duplicate_emails = 0 AND EXISTS(SELECT 1 FROM Runners WHERE race_id = NEW.race_id GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1)
    BEGIN SELECT RAISE(ABORT, 'Cannot disable shared emails while duplicates exist'); END`),
];
const ready = new WeakMap<D1Database, Promise<void>>();
export async function ensureParticipantSettings(db: D1Database) {
  let promise = ready.get(db);
  if (!promise) {
    promise = db.batch([PARTICIPANT_SETTINGS_SCHEMA,
      'CREATE INDEX IF NOT EXISTS idx_runners_event_email ON Runners(race_id,LOWER(TRIM(email)))',
      ...PARTICIPANT_EMAIL_TRIGGERS].map(sql => db.prepare(sql))).then(() => {});
    ready.set(db, promise); promise.catch(() => ready.delete(db));
  }
  await promise;
}
export async function allowsSharedEmail(db: D1Database, raceId: string): Promise<boolean> {
  await ensureParticipantSettings(db);
  const row = await db.prepare('SELECT allow_duplicate_emails FROM EventParticipantSettings WHERE race_id = ?').bind(raceId).first<any>();
  return row?.allow_duplicate_emails === 1;
}
export async function hasLegacyEmailConstraint(db: D1Database): Promise<boolean> {
  const result = await db.prepare("PRAGMA index_list('Runners')").all<any>();
  for (const index of result.results.filter(index => index.unique)) {
    const columns = await db.prepare(`PRAGMA index_info('${String(index.name).replace(/'/g, "''")}')`).all<any>();
    if (columns.results.some(column => column.name === 'race_id') && columns.results.some(column => column.name === 'email')) return true;
  }
  return false;
}
