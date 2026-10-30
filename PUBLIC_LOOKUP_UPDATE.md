# Optional public event lookup pages

Patch base: e312cde (the working import storage/recovery update).

## Participant flow

Share a public event URL such as:

https://walletpass.3fstriders.org/striders-race-2026

The branded landing page asks for first name, last name and email. A single exact
registration match for that event, with an issued pass and available private
Apple package, gets a 303 redirect to a new random secure pass URL. The browser
then follows the existing delivery flow:

- iPhone/iPad: private .pkpass download.
- Android: Google Wallet save URL.
- Desktop/unknown: your branded Apple/Google wallet-selection page.

The lookup does not send email, create a participant, call WalletWallet to issue
a pass, or change a pending pass to issued. It can restore an already-issued
pass's private R2 copy from its package retained in D1 if required, just like the
existing download route.

Matching ignores capitalization, surrounding/repeated spaces in names and Unicode
compatibility variants. Names are otherwise exact: no partial/fuzzy matches.
Email matching is case-insensitive. First and last names are separate fields so
participants can enter the same details used in the roster/CSV.

Shared inboxes are supported: different athletes using one email are distinguished
by their first and last names. If two registrations have identical normalized
names and email, the page returns the generic no-ready-pass response and creates
no token. Organizers should resolve those duplicate registrations in the roster.

## Enable a page

1. Sign in at https://admin-walletpass.3fstriders.org.
2. Open Events & Rosters and select the event (create it first if needed).
3. Find Public pass lookup page.
4. Enter a unique slug, for example striders-race-2026.
5. Select Enable public lookup for this event and click Save Lookup Page.
6. Copy or open the published URL and share it with participants.

Each event has one configurable page. It is off by default. Slugs accept 3–60
letters/numbers/hyphens, are saved lowercase, and must start/end with a letter or
number. Reserved names such as api, assets, lookup, pass, passes and admin cannot
be used. A 43-character slug is reserved for secure-token routing too.

The URL uses your existing PUBLIC_DOMAIN; example.org is supported only if that
domain is configured as the public hostname on your Worker. This update requires
no additional domain for the current walletpass.3fstriders.org deployment.

Changing a slug makes the old slug return 404. Disabling a page stops new lookups
but existing secure URLs issued through email or earlier lookups keep working.
Deleting an event removes its page via the existing event cascade.

## Access model and submission controls

This is deliberately a lookup by registration details, not verification that the
person controls the inbox. Anyone knowing the registered name and email can get
that participant's pass while the event's page is enabled. The organizer panel
displays this distinction beside the enable option. No OTP is required.

Only enabled event slugs on PUBLIC_DOMAIN are public. Unknown/disabled slugs, the
public homepage, public /api/* and public admin assets stay blocked. Access still
protects the entire admin hostname and its configuration APIs. Do not create a
Cloudflare Access login requirement on the participant lookup hostname.

Public submissions use POST, so typed names/emails are not added to the URL.
The form posts only to its first-party slug. Responses are private/no-store,
noindex, protected from embedding, and use no-referrer. A same-origin submission
check includes the Fetch Metadata case for native no-referrer form posts. Form
redirects permit Google domains to preserve the Android/Google sign-in flow;
the 303 removes the form body before those GET navigations.

Wrong details, pending/revoked/failed passes and ambiguous registrations receive
the same generic no-ready-pass message. No athlete list, provider serial, email
address, stored package or R2 key is rendered on the page. Storage failures show
a temporary-unavailable message and do not issue a token.

There is a basic limit of 10 POST attempts per event, per connecting IP, per
10-minute fixed window, including successful submissions. Too many attempts
return 429 with Retry-After. Participants sharing one network share that limit.
D1 stores hashed window/IP bucket keys, not raw IP addresses or submitted form
details. Expired buckets are cleaned on subsequent submissions. Missing IP headers
share an unknown-IP bucket. Cloudflare supplies CF-Connecting-IP on normal edge
requests; retain that header for per-visitor limiting.

These limits reduce guessing/token spam but do not prevent distributed guessing.
No Turnstile setup or new Worker binding is required for this version.

## Apply locally (PowerShell)

Extract the ZIP OUTSIDE the repository to avoid a duplicate TypeScript source tree.
From the repository folder:

```powershell
git status
git apply --check C:\path\to\public-lookup.patch
git apply C:\path\to\public-lookup.patch
npm run lint
npm test
npm run build
git diff --check
```

No npm dependency or Wrangler configuration change is introduced. If --check
fails, reconcile local edits first. Keep your working Access/domain configuration.

## Database setup

The Worker creates PublicLookupPages and PublicLookupAttempts automatically.
No existing table is rebuilt and no existing athlete/pass/job data is modified.
Queue pausing and a manual migration are not required for this feature.

For deployments that explicitly manage schema SQL, the patch includes an
idempotent migrations/0006_public_lookup_pages.sql file:

```powershell
npx wrangler d1 execute wallet_pass_db --remote --file=./migrations/0006_public_lookup_pages.sql
```

That optional command only creates the two new tables/index. You do not need to
rerun migration 0005 or any import-recovery SQL for this feature.

## Publish through GitHub

```powershell
git add server/publicLookup.ts worker/publicLookup.ts worker/index.ts server.ts schema.sql migrations/0006_public_lookup_pages.sql src/components/admin/PublicLookupSettings.tsx src/components/admin/RacesTab.tsx tests/passDelivery.test.ts PUBLIC_LOOKUP_UPDATE.md
git commit -m "Add optional public event pass lookup pages"
git push
```

Let the existing Cloudflare GitHub integration deploy, then enable the page in
the live event's organizer settings. Pages are not enabled just by deploying.

npm run dev remains the in-memory Express organizer preview. Its settings APIs
mirror this feature for UI editing, but its public lookup URL shows a clear Worker
required message and does not create insecure preview pass URLs. Test the real
lookup/download flow against the deployed Worker; local preview settings reset
when the development server restarts.

## Smoke test after deployment

1. Enable a page on a test event, then open its URL in a private browser window.
   It should show the event form without an Access login.
2. Use the first/last name and email of an issued athlete. Confirm the browser
   redirects to a secure-token URL and the correct wallet pass opens.
3. Test Apple, Android/Google sign-in and desktop selection. No WalletWallet-hosted
   landing page should appear.
4. Try a wrong name/email, a participant from another event and a pending/revoked
   pass: none should receive a secure URL.
5. For a shared inbox, enter each athlete's exact first/last name and confirm each
   reaches their own pass. Identical-name duplicates must not select arbitrarily.
6. Disable the page and verify its URL returns 404 while an existing emailed secure
   pass URL still works. Re-enable and verify the form returns.
7. Confirm the public homepage and /api/settings still return 404 and organizer
   pages still require Access.

Validation completed: 63 automated tests, TypeScript, production UI build,
Worker bundle and whitespace checks passed. Tests cover schema auto-initialization,
Access enforcement, slug conflicts/reservations, native form submission headers,
case/Unicode/space normalization, event isolation, shared inboxes and ambiguous
matches, rate limits, oversized/cross-origin requests, missing private packages,
secure-token redirects and byte-exact Apple delivery. Live browser/device and
Cloudflare checks remain manual; no remote deployment or data change was made.

References:
https://developers.cloudflare.com/fundamentals/reference/http-headers/
https://fetch.spec.whatwg.org/#origin-header
https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action
