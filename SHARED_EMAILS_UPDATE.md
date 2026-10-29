# Allow participants to share email addresses

Based on race-wallet-pass commit c718924 (email styling and signature logos).

## How to use it

In Events & Rosters, select an event, enable **Allow participants to share an
email address**, then click **Save Participant Settings**. The same checkbox is
available when creating an event. It is OFF by default for existing/new events.

With the setting enabled:

- Manual entry accepts multiple athletes with the same email address.
- Each CSV row creates its own athlete, pass record and import job, even when
  several rows use the same email. Names and bibs can differ.
- Each athlete has a separate secure URL, private Apple package, provider pass,
  and personalized invitation. The shared inbox receives a separate email for
  each athlete. Use distinct bibs where available for easier roster management.
- Editing an athlete can also assign an email shared by another athlete.
- Removing, updating or resending one athlete's pass uses that athlete's ID,
  so it does not affect another athlete using the address.

With the setting disabled, duplicate email addresses are rejected for that event.
Checks ignore capitalization and surrounding spaces. Different events can still
use the same email address, as before.

Turning the setting off is blocked if duplicate addresses remain in the event.
Change the affected athletes' addresses or remove unwanted registrations first.
The app never merges or silently deletes participants to enforce the setting.

### Import and retry behavior

In shared-email mode, importing the same CSV again creates more participants.
That is intentional: an email address no longer uniquely identifies an athlete.
Use **Retry Failed Athletes** in the original import batch to retry its existing
jobs. Those retries use participant/job IDs and do not create new participants.

The older **Retry pending athletes already saved in this event** checkbox matches
by email, so it is disabled/rejected in shared-email mode. It remains available
when shared emails are OFF. If you deleted an old job, recover the existing
athlete from the roster rather than importing the same row as a retry.

The protected email-only lookup API now returns a clear error when multiple
athletes match. Select the athlete by name/bib in the event roster and resend that
person's invitation. Public self-service lookup remains blocked by the existing
Cloudflare Access/hostname configuration.

## Important: one-time database migration required

The previous Runners table has UNIQUE(race_id,email). A checkbox cannot override
that constraint. Migration 0005 removes it and adds conditional database triggers
that enforce uniqueness only when the event's shared-email setting is OFF.

The migration preserves all current athlete IDs, pass IDs, WalletWallet serials,
R2 keys, signed packages retained in D1, secure-token hashes, import-job states,
attempt counts, timestamps, templates and event assignments. R2 objects and
WalletWallet passes do not need to be recreated.

Runners, Passes, PassLinks and ImportJobs are copied into replacement tables before
the old child tables and parent table are replaced. This avoids cascade deletion
of related records. Data is copied by explicit column names, including support for
older deployments where bootstrap appended r2_key at the end of Passes.

Use the migration runner below, which tracks completion and rolls back a failed
migration. Do not run individual DROP statements or try to remove the SQLite
autoindex manually. The app refuses to enable shared emails if the old unique
constraint is still present.

## 1. Apply and test locally (PowerShell)

Extract this ZIP outside your repository. It contains only the patch and this
guide, so it will not create another TypeScript source tree inside the project.

From your repository folder:

```powershell
git status
git apply --check C:\path\to\shared-emails.patch
git apply C:\path\to\shared-emails.patch
npm run lint
npm test
npm run build
```

Stop if --check fails; reconcile local differences before applying. No new npm
dependency is introduced. Run npm install if existing dependencies are missing.

## 2. Back up and migrate the existing D1 database

Do this during a short window when organizers are not adding/editing/deleting
athletes or importing CSVs. Pause queue delivery and allow any already-running
consumer work to finish. Queue pausing does not cancel jobs or purge messages.

```powershell
npx wrangler queues pause-delivery pass-issuance-queue
npx wrangler d1 export wallet_pass_db --remote --output=..\wallet-pass-before-shared-emails.sql
npx wrangler d1 migrations list wallet_pass_db --remote
```

Keep the exported backup private; it contains athlete data and application
settings. Confirm that migration 0005_shared_participant_emails.sql is listed.
Earlier unapplied repository migrations 0001–0004 only create their existing
tables/indexes with IF NOT EXISTS, so they can also appear on a database that was
previously initialized automatically by the Worker. Review any other pending
migrations before proceeding.

Record these counts before migration:

```powershell
$sharedEmailCountsSql = "SELECT 'Runners' AS table_name,COUNT(*) AS row_count FROM Runners UNION ALL SELECT 'Passes',COUNT(*) FROM Passes UNION ALL SELECT 'PassLinks',COUNT(*) FROM PassLinks UNION ALL SELECT 'ImportJobs',COUNT(*) FROM ImportJobs;"
npx wrangler d1 execute wallet_pass_db --remote --command $sharedEmailCountsSql
```

Apply the pending migration(s) as a unit, using Wrangler's migration runner:

```powershell
npx wrangler d1 migrations apply wallet_pass_db --remote
npx wrangler d1 execute wallet_pass_db --remote --command $sharedEmailCountsSql
npx wrangler d1 execute wallet_pass_db --remote --command "PRAGMA foreign_key_check;"
```

All four row counts should match the earlier counts and foreign_key_check should
return no violations. Do not continue if migration fails. Wrangler rolls back the
failed migration; retain the backup and error details for troubleshooting.

This migration is tracked in d1_migrations. Do not repeatedly execute its SQL file
directly. For a genuinely new empty installation, schema.sql already contains the
new layout; the migration also supports that layout if all required tables exist.

## 3. Commit, push and resume the queue

```powershell
git add schema.sql migrations/0005_shared_participant_emails.sql server/participantEmails.ts server/db.ts server.ts worker/participantSettings.ts worker/importJobs.ts worker/index.ts src/types/index.ts src/components/admin/RacesTab.tsx src/components/admin/CsvUploaderTab.tsx tests/passDelivery.test.ts tests/sharedEmailMigration.test.ts tests/fixtures/pre-shared-emails.sql SHARED_EMAILS_UPDATE.md
git commit -m "Allow shared participant emails per event"
git push
```

Let Cloudflare deploy through your usual GitHub integration. Once migration and
deployment have succeeded:

```powershell
npx wrangler queues resume-delivery pass-issuance-queue
```

The existing Worker remains compatible with the migrated schema while the new
build deploys: events still default to disallowing duplicate emails. No Worker
secrets, domains, Access policies, R2 bindings or email designs need changing.

## 4. Smoke test

1. On a test event with the option OFF, add two different athletes using the same
   address. The second must be rejected with an understandable message.
2. Enable the option and save. Add the second athlete again; confirm separate
   roster entries and passes.
3. Import two CSV rows with one shared inbox and different names/bibs. Confirm both
   are queued, both appear in the roster, and the inbox receives two invitations
   with different secure links. Open each link to check the matching athlete.
4. Refresh Events & Rosters to confirm the setting persists. Verify the import
   page describes that event's shared-email behavior.
5. Try disabling the option while duplicate emails exist: it must be blocked.
6. Change the addresses to be unique; confirm disabling now works.

Validation: 53 tests, TypeScript, Vite production build and Worker bundle passed.
Coverage includes the old and new email policies, manual create/edit, separate
queued passes for a shared inbox, retry recovery by IDs, distinct secure URLs,
legacy-constraint detection, migration data preservation with foreign keys ON,
rollback and differing column order on older deployments. Browser and live
Cloudflare/email checks remain manual; no remote migration, email send or deploy
was performed here.

Official references:

- https://developers.cloudflare.com/d1/sql-api/sql-statements/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
- https://developers.cloudflare.com/queues/configuration/pause-purge/
