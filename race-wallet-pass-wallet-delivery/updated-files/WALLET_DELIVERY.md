# First-party wallet delivery

Emails now contain `https://walletpass.3fstriders.org/<secure-token>`.
The Worker handles this route before static assets:

| Request | Result |
| --- | --- |
| iPhone, iPad, iPod, or Macintosh UA containing Mobile | Streams the signed Apple package from private R2 |
| Android | 302 to the stored HTTPS `pay.google.com` save URL |
| Desktop, unknown, or Android without a valid Google URL | 3F Striders page with wallet buttons |
| `/<token>/apple` | Explicit Apple download regardless of User-Agent |
| `/<token>/google` | Explicit Google redirect, or selection page if unavailable |

Apple responses use exactly:

```text
Content-Type: application/vnd.apple.pkpass
Content-Disposition: attachment; filename="access-pass.pkpass"
Cache-Control: private, no-store
```

The initial provider package is decoded and stored unchanged. It is not regenerated
on download. Its signature and embedded web-service configuration are preserved;
updates after installation continue through the provider's own service. This change
does not replace WalletWallet's signing certificate or Google issuer identity.
`share_url` is retained in D1 for organizer recovery, but recipient responses and
emails never render it. The desktop page uses buttons and makes no third-party QR
requests that could disclose the bearer token.

## Storage and issuance

`ASSETS_BUCKET` remains the public graphics bucket. `PASSES_BUCKET` is a separate,
private bucket named `wallet-pass-private`. Do not enable its r2.dev URL or connect
any public custom domain. R2 does not have private-per-object access controls in a
public bucket; placing packages under a special prefix is insufficient.

Immediate creation, explicit synchronization, and queued CSV issuance retain the
provider response in D1, then await private R2 persistence before marking the pass
issued and emailing its link. If R2 fails, the retained base64 package can be
retried. Queue retries reuse that package instead of asking for another pass.
Email delivery failure also retries the queue message. A crash between provider
creation and D1 retention can still cause duplicate provider issuance; this change
does not add provider-side idempotency. Keep D1 backup bytes until migration is
verified; they are deliberately retained for recovery.

Downloads never call WalletWallet to fetch or create a missing package and never
serve the former unsigned local fallback. Missing packages produce a 503. Existing
D1 packages can be copied into private R2 during email delivery or Apple download,
and `POST /api/r2/sync-all` can backfill them without reissuing.

## Tokens and authorization

Each delivered or organizer-created link uses 32 cryptographically random bytes,
encoded as 43 base64url characters. D1 `PassLinks` stores only the SHA-256 hash and
the associated runner ID. Tokens are bearer credentials: anybody with the URL can
use it. Links remain valid on resend and have no automatic expiration. Revoking
the pass blocks every associated link; deleting its PassLinks records invalidates
links independently. Reissuing a revoked pass re-enables retained links, so delete
those records first when revocation is due to a leaked link.

Responses disable caching and set `Referrer-Policy: no-referrer`; the desktop page
loads no external assets. Do not log full recipient URLs or include them in
analytics. GET and HEAD do not mark a pass installed: email scanners and downloads
are not installation evidence.

**Existing organizer APIs have no application authentication in this repository.**
The new organizer `POST /api/pass/link/:runnerId` has the same trust boundary as
existing create/sync/send-email/settings APIs. Protect organizer routes with
Cloudflare Access or equivalent authenticated authorization before treating the
public deployment as secure. In particular, exposed settings and sync endpoints
can disclose credentials or pass bytes independently of these recipient tokens.
The token feature alone does not secure the organizer backend.

When configuring Access, keep `/api/lookup`, token root routes, and their
`/apple` and `/google` actions public. Protect all other `/api/*` routes and the
organizer UI. Legacy download/details aliases, if retained for compatibility,
require `?token=<secure-token>` and must match its runner. Public email-only lookup
sends the capability to the registered inbox; it never returns the capability or
provider URLs to the caller. Apply rate limits to lookup separately.

## Deploy an existing Worker

1. Create the new private bucket and add the `PASSES_BUCKET` binding from
   `wrangler.toml`. Keep public access disabled:

   ```powershell
   npx wrangler r2 bucket create wallet-pass-private
   ```

2. Back up D1. Existing deployments already add `r2_key` through bootstrap;
   invoke `/api/stats` once on the current deployment if needed. Apply the
   idempotent link-table migration before switching the Worker:

   ```powershell
   npx wrangler d1 execute wallet_pass_db --remote --file=./migrations/0001_pass_links.sql
   ```

   For a fresh database use `schema.sql` instead. The Worker also creates
   PassLinks before generating a link. Ensure `PUBLIC_DOMAIN` or the saved
   `publicDomain` setting points to `https://walletpass.3fstriders.org`.

3. Build/test locally and commit/push these changes through your existing
   Cloudflare deployment pipeline. `run_worker_first = true` is required so
   root token paths reach the Worker rather than the SPA assets handler:

   ```powershell
   npm install
   npm run lint
   npm run build
   npm test
   npx wrangler dev
   ```

   Tests use Node's SQLite adapter; run them on Node 22.18+ or Node 24. The
   Express `npm run dev` server remains a mock preview and does not implement
   the private Worker delivery route. Use Wrangler for this feature.

4. Protect organizer routes as above. Run `POST /api/r2/sync-all` through that
   authenticated organizer context; verify `failures` is empty. This backfills
   existing D1 packages. If a historical pass has no retained provider package,
   it needs explicit organizer reissuance; no download-again endpoint is assumed.
   This process does not delete old public objects. Remove previously saved
   participant `.pkpass` objects from `wallet-pass-assets` and purge any cached
   copies. Check all historical key shapes: `<runnerId>.pkpass`,
   `passes/<runnerId>.pkpass`, and `passes/<runnerId>/pass.pkpass`.

5. Resend pass emails. Old `/pass/<runnerId>` links return 410 with instructions
   to request a new email. Organizer Copy/Open/Download actions generate token
   links. Email lookup no longer offers a runner-ID-based Open Pass shortcut.

6. Verify a real pass on an iPhone, iPad, Android phone, and desktop. Check that
   no recipient action goes to WalletWallet, that revoked links stop working,
   and that the installed Apple pass still receives provider updates. Automated
   tests exercise Worker routes, real SQLite queries, mocked R2/provider/Resend
   interactions, byte preservation, storage retries, headers, and lookup privacy;
   they do not validate a provider signature or a live wallet installation.
