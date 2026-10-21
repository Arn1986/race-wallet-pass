# CSV athlete importer fix

Prepared against GitHub commit 6c6cbb8, which includes the Pass Studio fix.

## Changes

The old importer could show a green success notice for failed API requests, count
rows it silently skipped as queued, and hide network errors in the browser console.
It also used a basic comma split and called queue-monitor endpoints that exist only
in the Express simulator, not in the deployed Worker. These code problems explain
several ways an import could appear to do nothing; live Cloudflare logs were not
available to determine which occurred in your previous five-athlete test.

The replacement provides:

- Download Sample CSV and Preview Sample buttons using the same five-athlete file.
- Required email/first_name/last_name checks, readable parsing errors, and support
  for quoted commas, escaped quotes, quoted line breaks, UTF-8 BOM, CRLF, and
  semicolon/tab exports. Standard header aliases such as First Name are recognized.
- Accurate saved, queued, invalid, skipped, and resumed counts. Existing issued
  athletes are skipped rather than duplicated or overwritten.
- Optional Retry pending athletes already saved in this event. Use it to recover
  old imports that created pending rows without queueing/issuing them. It updates
  those pending athletes from the corrected CSV and creates new tracked jobs; it
  skips issued athletes and jobs already tracked as actively processing. Verify an
  old untracked queue job is not still running before using recovery.
- Transactional D1 inserts for athletes, pending passes, and ImportJobs records.
  A failed insert rolls back the batch and sends no queue messages.
- Per-import progress from D1 job records, not fabricated queue metrics. States
  include queued, processing, retrying, failed, enqueue_failed, cancelled, completed.
- Visible provider/Resend errors and Retry Failed Athletes without creating new
  athlete rows. Missing PASS_QUEUE rejects the import before saving athletes.
- Automatic processing through the existing queue consumer. There is no manual
  Execute Worker Batch button in the deployed importer.

Completed means the signed package was stored privately, the pass marked issued,
and Resend accepted the invitation. It does not confirm inbox delivery or wallet
installation. Completed jobs are skipped on later message redelivery. Cloudflare
Queues is at-least-once: crashes during external API calls or concurrent duplicate
messages can still cause repeat provider calls/emails; this is not exactly-once
issuance.

The consumer now uses batches of 2, a 5-second batch timeout, 3 retries, and a
30-second retry delay. Smaller batches reduce per-invocation database work. The
monitor polls every 5 seconds while jobs are active and remembers the latest
import ID when the tab is reopened.

The importer currently accepts up to 100 athletes per file, a 1 MB CSV, and 100 KB
per athlete row. Split larger rosters. Queue messages are grouped by size as well
as count. The sample uses example.com addresses; replace them with real addresses
before importing. Other CSV columns are retained in dynamic_data so the assigned
race/template field mappings continue to work.

## Apply and deploy

Extract the archive. It contains the patch, this guide, and the sample CSV; it does
not contain a duplicate TypeScript source tree.

From your repository root in PowerShell:

```powershell
git apply --check C:\path\to\csv-import-fix.patch
git apply C:\path\to\csv-import-fix.patch
npm run lint
npm test
npm run build
```

Recommended migration for the new progress table and batch index:

```powershell
npx wrangler d1 execute wallet_pass_db --remote --file=./migrations/0002_import_jobs.sql
```

This is idempotent. For fresh databases the table is included in schema.sql.
The Worker also creates the table on first use, so importing does not depend on
manually running the migration; the migration adds the batch index too.

Commit/push through your existing GitHub-to-Cloudflare pipeline. No new bucket or
queue is introduced. Keep both the PASS_QUEUE producer binding and the
pass-issuance-queue consumer pointing to this Worker. Keep the organizer APIs,
including the new /api/import/<batch>/status and /retry endpoints, behind your
existing organizer access policy.

## Verify your five athletes

1. Deploy this update, then download the sample CSV from the importer.
2. Replace example.com addresses with five controlled test inboxes and select the
   correct race/template. Review the preview before clicking Import 5 Athletes.
3. Expect Queued: 5, followed by per-athlete processing and completion/error rows.
4. If the same addresses already exist as pending athletes from your earlier test,
   enable Retry pending athletes already saved in this event before importing.
   An already-issued athlete is skipped; use its existing roster email action if
   only email redelivery is needed.
5. If jobs remain queued, check the queue has the race-wallet-pass Worker attached
   as consumer and delivery is enabled. If jobs retry/fail, fix the displayed
   provider key, quota, private R2 binding, Resend key, or sender-domain error, then
   use Retry Failed Athletes after automatic retries finish.

The Express `npm run dev` server is an in-memory preview and now rejects bulk
issuance with a clear message. Use `npx wrangler dev` with local D1 initialized and
bindings configured, or the deployed Worker, for this feature.

Validation: 27 automated tests, TypeScript checks, and production build pass. Tests
cover the five-row sample through Worker import/issuance/email handling, duplicate
skips, pending-athlete recovery, CSV edge cases, producer/consumer failures, D1
rollback, and 100-row limits. SQLite and mocked provider/R2/Resend/Queue services
were used; no real athlete emails, provider charges, remote database mutations,
GitHub pushes, or deployment were performed.

References:
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/queues/configuration/javascript-apis/
- https://developers.cloudflare.com/queues/configuration/batching-retries/
