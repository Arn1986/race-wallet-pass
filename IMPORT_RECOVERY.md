# Recover interrupted wallet-pass imports

Patch base: 3ab7f84 (shared participant emails). No new database migration.

## What the supplied rows establish

Seven rows are processing with a saved WalletWallet serial and Apple package,
pending pass status, and no recorded R2 key. Six belong to the 44-athlete batch;
one belongs to an earlier batch. Two additional jobs in the latest batch have
never started (queued, attempts 0, no saved package or provider serial).

The saved packages are reusable. No replacement provider passes are needed for
those seven rows. A missing R2 key does not prove that an object was never written;
the Worker may have stopped before recording the key. Recovery writes to the same
deterministic private object key if necessary.

The stopping point is between retaining the provider response and recording
private storage/issuance. Repeated processing rows with no caught error suggest
an interrupted invocation, such as a CPU/resource termination. This is an
inference; Cloudflare invocation outcomes/tail logs are needed to confirm it.
It is not evidence of a WalletWallet creation failure or a Resend failure.

## Changes

- Replace Uint8Array.from(binary, callback) decoding with native fromBase64 where
  available, and a tight typed-array loop otherwise. Both preserve exact bytes.
- Record r2_key immediately after a successful private upload.
- Avoid writing the entire large package to D1 again in the queue handler.
- max_batch_size = 1 and max_concurrency = 1: one athlete per invocation and one
  queue consumer invocation at a time. Overall imports may take longer.
- Structured progress logs show package retention, decode, R2 upload, issuance,
  email sending and job completion, using runner/job IDs and sizes only.
- Caught errors include the active stage. Hard runtime termination may still
  prevent JavaScript error handling; Cloudflare logs remain necessary then.

Completed jobs are skipped on sequential redelivery. Queue processing remains
at-least-once; this patch does not claim exactly-once email delivery or solve an
interruption before a provider response is retained.

## 1. Pause delivery

Do not delete these rows, clear their saved packages, reimport the CSV, use pass
reissue, or manually mark the passes issued. Keep the existing participant IDs.

In PowerShell from your project directory:

```powershell
npx wrangler queues pause-delivery pass-issuance-queue
```

Confirm any already-running queue invocation has finished or terminated before
the recovery UPDATE below. Pause prevents new deliveries, not work already running.
Avoid manual pass issuance/resends for the affected athletes during recovery.

## 2. Apply, test and deploy the patch

Extract the ZIP outside the repository, then run from the repository folder:

```powershell
git apply --check C:\path\to\import-recovery.patch
git apply C:\path\to\import-recovery.patch
npm run lint
npm test
npm run build
git diff --check
git add worker/passDelivery.ts worker/index.ts wrangler.toml tests/passDelivery.test.ts tests/packageDecode.test.ts IMPORT_RECOVERY.md
git commit -m "Reduce pass storage CPU work and diagnose interrupted imports"
git push
```

Wait for the Cloudflare GitHub deployment to succeed. Verify that the deployed
queue consumer has batch size 1 and maximum consumer invocations 1. These limits
must be in effect before resuming delivery and retrying these jobs.
This patch does not change your working Access or domain values.

## 3. Make only the stale jobs eligible for Retry

In the protected app's D1 query console or Cloudflare D1 console, preview:

```sql
SELECT id, batch_id, runner_id, state, attempts, updated_at
FROM ImportJobs
WHERE batch_id IN (
  '7696b91f-8245-4941-bb5c-5195d7202301',
  '2d448289-a474-4bf8-ae84-89b9fef704b8'
)
AND state IN ('queued', 'processing', 'retrying')
AND updated_at < datetime('now', '-15 minutes');
```

If these are the intended stalled jobs and the queue is paused with no invocation
still running, run:

```sql
UPDATE ImportJobs
SET state = 'failed',
    last_error = COALESCE(last_error, 'Stale interrupted import; ready for recovery'),
    updated_at = CURRENT_TIMESTAMP
WHERE batch_id IN (
  '7696b91f-8245-4941-bb5c-5195d7202301',
  '2d448289-a474-4bf8-ae84-89b9fef704b8'
)
AND state IN ('queued', 'processing', 'retrying')
AND updated_at < datetime('now', '-15 minutes');
```

This only changes job tracking. It preserves Passes, packages, serials, athletes
and existing secure links. Completed jobs are excluded. If zero rows qualify,
check whether they already finished or are not yet 15 minutes old; do not widen
the update to all jobs or reset completed jobs.

## 4. Requeue the original jobs, then resume

Use Retry Failed Athletes on the latest batch in the importer. To recover both
listed batches, an alternative is the following in the browser developer console
while logged into https://admin-walletpass.3fstriders.org. Run this once:

```javascript
for (const batchId of [
  '7696b91f-8245-4941-bb5c-5195d7202301',
  '2d448289-a474-4bf8-ae84-89b9fef704b8'
]) {
  const response = await fetch(`/api/import/${batchId}/retry`, { method: 'POST' });
  const result = await response.json();
  console.log(batchId, result);
  if (!response.ok || !result.success) throw new Error(result.error || 'Retry failed');
}
```

Choose either the UI retry or this console action for each batch. The endpoint
resets attempts and queues the existing job IDs. It does not import new athletes.
If enqueueing fails, keep delivery paused, inspect the error and retry that batch
after correcting it; the endpoint marks those enqueue failures for recovery.

Open a separate PowerShell window to capture live logs:

```powershell
npx wrangler tail race-wallet-pass
```

Then resume delivery in your other PowerShell window:

```powershell
npx wrangler queues resume-delivery pass-issuance-queue
```

The seven saved-package jobs should log restore_saved_package and reuse their
current provider passes. The two never-started jobs follow normal creation. Old
queue messages can also arrive; completed jobs are skipped when those arrive
sequentially under the configured single consumer.

## 5. Verify completion

Refresh Import Progress and run the original diagnostic query again. Recovered
jobs should show state completed, pass_status issued, the original provider
serials for the seven saved packages, and has_r2_key = 1. Check a recipient's
download link and invitation as well.

If a row still stops, send the tail output and Cloudflare invocation outcome:

- decode_start without r2_put_start: interrupted during decode.
- r2_put_start without r2_put_complete: storage operation or invocation interrupted.
- r2_put_complete followed by failure: inspect the D1 key/status write stage.
- send_invitation: inspect the Resend error/rate limit.
- CPU/memory/resource-exceeded outcomes: confirm the actual Workers plan and
  resource limits before changing plan-specific CPU settings.

Optional package-size query (does not expose package contents):

```sql
SELECT runner_id, LENGTH(apple_pass_base64) AS base64_characters
FROM Passes
WHERE runner_id IN (
  SELECT runner_id FROM ImportJobs
  WHERE batch_id = '7696b91f-8245-4941-bb5c-5195d7202301'
  AND state <> 'completed'
);
```

Validation: 57 automated tests, TypeScript, production UI build, Worker bundle
and whitespace checks passed. Tests cover 512 KB packages, native and fallback
decoding, private-byte equality, and recovery of an existing tracked job without
another provider create or a second email on sequential redelivery.
No live database, queue or deployment was changed here; production recovery and
the underlying runtime failure still require the checks above.

References:
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/queues/configuration/batching-retries/
https://developers.cloudflare.com/queues/configuration/consumer-concurrency/
