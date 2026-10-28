import type { EmailTemplateContent } from '../server/emailTemplates.ts';
export const EMAIL_TEMPLATE_SCHEMA = `CREATE TABLE IF NOT EXISTS EmailTemplates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`;
export const EVENT_EMAIL_SCHEMA = `CREATE TABLE IF NOT EXISTS EventEmailTemplates (
  race_id TEXT PRIMARY KEY, email_template_id TEXT NOT NULL,
  FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE,
  FOREIGN KEY (email_template_id) REFERENCES EmailTemplates(id) ON DELETE CASCADE
)`;
const ready = new WeakMap<D1Database, Promise<void>>();
export function ensureEmailTemplateSchema(db: D1Database): Promise<void> {
  let promise = ready.get(db);
  if (!promise) {
    promise = (async () => { await db.prepare(EMAIL_TEMPLATE_SCHEMA).run(); await db.prepare(EVENT_EMAIL_SCHEMA).run(); })();
    ready.set(db, promise);
    promise.catch(() => ready.delete(db));
  }
  return promise;
}
export async function selectedTemplateExists(db: D1Database, id: any): Promise<boolean> {
  return id === '' || id === null || id === undefined || typeof id === 'string' && !!await db.prepare('SELECT id FROM EmailTemplates WHERE id = ?').bind(id).first();
}
export async function setEventEmailTemplate(db: D1Database, raceId: string, id: string | null) {
  if (!id) { await db.prepare('DELETE FROM EventEmailTemplates WHERE race_id = ?').bind(raceId).run(); return; }
  await db.prepare(`INSERT INTO EventEmailTemplates (race_id, email_template_id) VALUES (?, ?)
    ON CONFLICT(race_id) DO UPDATE SET email_template_id = excluded.email_template_id`).bind(raceId, id).run();
}
export async function emailContext(db: D1Database, runnerId: string) {
  await ensureEmailTemplateSchema(db);
  const row = await db.prepare(`SELECT ru.*, r.name AS event_name, r.event_date, r.location AS event_location, r.field_mapping,
    et.name AS email_name, et.subject AS email_subject, et.message AS email_message FROM Runners ru JOIN Races r ON r.id = ru.race_id
    LEFT JOIN EventEmailTemplates ee ON ee.race_id = r.id LEFT JOIN EmailTemplates et ON et.id = ee.email_template_id
    WHERE ru.id = ?`).bind(runnerId).first<any>();
  if (!row) throw new Error('Participant event not found');
  return { runner: row, event: { name: row.event_name, event_date: row.event_date, location: row.event_location, field_mapping: row.field_mapping },
    template: row.email_subject === null ? undefined : { name: row.email_name, subject: row.email_subject, message: row.email_message } as EmailTemplateContent };
}
