import { allowsSharedEmail, hasLegacyEmailConstraint } from './participantSettings.ts';
import type { Env } from './index.ts';
import { MAX_IMPORT_ROWS, validateAthleteRows, type ImportIssue } from '../server/csvImport.ts';

export const IMPORT_JOBS_SCHEMA = `CREATE TABLE IF NOT EXISTS ImportJobs (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, runner_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
)`;
export async function ensureImportJobs(env: Env) { await env.DB.prepare(IMPORT_JOBS_SCHEMA).run(); }

export async function importAthletes(env: Env, raceId: string, rows: unknown[], resumePending = false): Promise<{ status: number; body: any }> {
  if (!raceId || !Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) {
    return { status: 400, body: { success: false, error: `race_id and 1–${MAX_IMPORT_ROWS} athlete rows are required` } };
  }
  const race = await env.DB.prepare('SELECT id FROM Races WHERE id = ?').bind(raceId).first<any>();
  if (!race) return { status: 404, body: { success: false, error: 'The selected event does not exist' } };
  if (!env.PASS_QUEUE) return { status: 503, body: { success: false, error: 'PASS_QUEUE is not configured; no athletes were imported' } };
  const allowDuplicates = await allowsSharedEmail(env.DB, raceId);
  if (allowDuplicates && await hasLegacyEmailConstraint(env.DB)) return { status: 503, body: { success: false, error: 'Apply migration 0005_shared_participant_emails.sql before importing shared emails.' } };
  if (allowDuplicates && resumePending) return { status: 400, body: { success: false, error: 'Retry pending athletes by email is unavailable when shared emails are enabled. Use Retry Failed Athletes for the original import batch instead.' } };
  const { athletes, errors } = validateAthleteRows(rows);
  const unique: typeof athletes = [], seen = new Set<string>(), skipped: ImportIssue[] = [];
  for (const athlete of athletes) {
    if (!allowDuplicates && seen.has(athlete.email)) skipped.push({ row: athlete.row, email: athlete.email, error: 'Duplicate email in this CSV' });
    else { seen.add(athlete.email); unique.push(athlete); }
  }
  await ensureImportJobs(env);
  const existing = new Map<string, any>();
  for (let offset = 0; !allowDuplicates && offset < unique.length; offset += 90) {
    const emails = unique.slice(offset, offset + 90).map(a => a.email);
    const records = await env.DB.prepare(`SELECT r.id, r.email, p.status AS pass_status FROM Runners r LEFT JOIN Passes p ON p.runner_id = r.id WHERE r.race_id = ? AND LOWER(TRIM(r.email)) IN (${emails.map(() => '?').join(',')})`)
      .bind(raceId, ...emails).all<any>();
    for (const row of records.results) existing.set(row.email.trim().toLowerCase(), row);
  }
  const active = new Set<string>();
  if (resumePending && existing.size) {
    const ids = [...existing.values()].map(a => a.id);
    for (let offset = 0; offset < ids.length; offset += 90) {
      const chunk = ids.slice(offset, offset + 90);
      const jobs = await env.DB.prepare(`SELECT runner_id FROM ImportJobs WHERE state IN ('queued', 'processing', 'retrying') AND runner_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<any>();
      for (const job of jobs.results) active.add(job.runner_id);
    }
  }
  const accepted = unique.filter(a => {
    const old = existing.get(a.email);
    if (!old) return true;
    if (resumePending && ['pending', 'failed', null].includes(old.pass_status) && !active.has(old.id)) return true;
    skipped.push({ row: a.row, email: a.email, error: active.has(old.id) ? 'Already being processed' :
      ['pending', 'failed', null].includes(old.pass_status) ? 'Already saved but not issued. Enable Retry pending athletes to resume.' : 'Already registered for this event' });
    return false;
  });
  if (!accepted.length) return { status: errors.length ? 400 : 200, body: { success: !errors.length,
    message: 'No new athletes to import', error: errors.length ? 'Correct the invalid rows and try again' : undefined,
    data: { total_received: rows.length, total_enqueued: 0, total_skipped: skipped.length, total_invalid: errors.length, skipped, errors } } };
  const batchId = crypto.randomUUID();
  const jobs = accepted.map(a => ({ ...a, runnerId: existing.get(a.email)?.id || `run-${crypto.randomUUID()}`, jobId: crypto.randomUUID() }));
  const statements: D1PreparedStatement[] = [];
  // Multi-row statements keep bound parameters below D1's per-statement limit.
  for (let offset = 0; offset < jobs.length; offset += 10) {
    const chunk = jobs.slice(offset, offset + 10);
    statements.push(env.DB.prepare(`INSERT INTO Runners (id, race_id, email, first_name, last_name, dynamic_data) VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(',')} ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, dynamic_data = excluded.dynamic_data`)
      .bind(...chunk.flatMap(a => [a.runnerId, raceId, a.email, a.first_name, a.last_name, JSON.stringify(a.dynamic_data)])));
    statements.push(env.DB.prepare(`INSERT INTO Passes (id, runner_id, status) VALUES ${chunk.map(() => "(?,?,'pending')").join(',')} ON CONFLICT(runner_id) DO NOTHING`)
      .bind(...chunk.flatMap(a => [`pass-${a.runnerId}`, a.runnerId])));
    statements.push(env.DB.prepare(`INSERT INTO ImportJobs (id, batch_id, runner_id) VALUES ${chunk.map(() => '(?,?,?)').join(',')}`)
      .bind(...chunk.flatMap(a => [a.jobId, batchId, a.runnerId])));
  }
  await env.DB.batch(statements); // D1 rolls back the batch if an insert fails.
  let enqueueError: string | undefined, enqueuedCount = 0;
  const messages = jobs.map(a => ({ body: { import_job_id: a.jobId, runner_id: a.runnerId, race_id: raceId,
    payload: { email: a.email, first_name: a.first_name, last_name: a.last_name, dynamic_data: a.dynamic_data } } }));
  try {
    while (enqueuedCount < messages.length) {
      const chunk: typeof messages = [];
      let bytes = 0;
      for (const message of messages.slice(enqueuedCount)) {
        const size = new TextEncoder().encode(JSON.stringify(message.body)).byteLength;
        if (chunk.length && bytes + size > 240_000) break;
        chunk.push(message); bytes += size;
      }
      await env.PASS_QUEUE.sendBatch(chunk);
      enqueuedCount += chunk.length;
    }
  } catch {
    enqueueError = 'Athletes were saved, but some could not be queued. Check the queue binding and retry failed athletes below.';
    const remaining = jobs.slice(enqueuedCount).map(a => a.jobId);
    for (let offset = 0; offset < remaining.length; offset += 90) {
      const ids = remaining.slice(offset, offset + 90);
      await env.DB.prepare(`UPDATE ImportJobs SET state = 'enqueue_failed', last_error = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND state = 'queued'`)
        .bind(enqueueError, ...ids).run();
    }
  }
  return { status: enqueueError ? 503 : 202, body: { success: !enqueueError, error: enqueueError,
    message: enqueueError || `${jobs.length} athletes imported. Passes and emails are being processed.`,
    data: { batch_id: batchId, total_received: rows.length, total_saved: jobs.length, total_resumed: jobs.filter(a => existing.has(a.email)).length, total_enqueued: enqueuedCount,
      total_skipped: skipped.length, total_invalid: errors.length, skipped, errors } } };
}

export async function importStatus(env: Env, batchId: string): Promise<any> {
  await ensureImportJobs(env);
  const result = await env.DB.prepare(`SELECT j.id, j.state, j.attempts, j.last_error, j.updated_at,
    r.email, r.first_name, r.last_name, p.status AS pass_status FROM ImportJobs j
    JOIN Runners r ON r.id = j.runner_id LEFT JOIN Passes p ON p.runner_id = r.id
    WHERE j.batch_id = ? ORDER BY j.created_at, r.email`).bind(batchId).all<any>();
  const counts: Record<string, number> = {};
  for (const row of result.results) counts[row.state] = (counts[row.state] || 0) + 1;
  return { batch_id: batchId, total: result.results.length, counts, rows: result.results };
}

export async function retryEnqueue(env: Env, batchId: string): Promise<number> {
  if (!env.PASS_QUEUE) throw new Error('PASS_QUEUE is not configured');
  const result = await env.DB.prepare("SELECT id, runner_id FROM ImportJobs WHERE batch_id = ? AND state IN ('enqueue_failed', 'failed')").bind(batchId).all<any>();
  if (!result.results.length) return 0;
  const ids = result.results.map(j => j.id);
  await env.DB.prepare(`UPDATE ImportJobs SET state = 'queued', attempts = 0, last_error = NULL WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  try {
    await env.PASS_QUEUE.sendBatch(result.results.map(j => ({ body: { import_job_id: j.id, runner_id: j.runner_id } })));
  } catch (error) {
    await env.DB.prepare(`UPDATE ImportJobs SET state = 'enqueue_failed' WHERE id IN (${ids.map(() => '?').join(',')}) AND state = 'queued'`).bind(...ids).run();
    throw error;
  }
  return ids.length;
}
