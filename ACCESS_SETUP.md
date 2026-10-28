# Protect organizers with Cloudflare Access

This patch is based on repository commit 64788a6 (email-template feature).
No D1 migration, changes to existing tokens, or reissued passes are needed.

## Result

| Address | Behavior |
| --- | --- |
| https://admin-walletpass.3fstriders.org | Dashboard and organizer APIs; Cloudflare Access login required |
| https://walletpass.3fstriders.org/TOKEN | Existing public device detection and wallet downloads |
| https://walletpass.3fstriders.org/TOKEN/apple | Private R2 Apple package; no participant login |
| https://walletpass.3fstriders.org/TOKEN/google | Google Wallet redirect; no participant login |
| Public hostname root, lookup, assets, APIs, legacy downloads | 404 |
| Other hostnames, including alternate Worker URLs | 404 |

The gate runs before static assets, API handlers, CORS preflight, or database operations.
Organizer requests require a cryptographically verified RS256 Access JWT with the
configured issuer, application audience, expiration, issued-at and subject claims.
JWKS public keys are fetched and cached with jose, including support for key rotation.
Missing Access configuration blocks organizer access; public token links still work.
The queue consumer runs without an HTTP login and continues processing imported athletes.

Email buttons and roster Copy Link/Open Pass actions always use PUBLIC_DOMAIN.
Legacy publicDomain settings saved in D1 cannot override it. The Settings field is
read-only; changing the participant hostname now requires changing wrangler.toml.

## 1. Apply locally (PowerShell)

Extract this ZIP OUTSIDE your repository. It contains a patch and this guide,
not a second copy of the application source.

From the repository folder, with your previous email-template update applied:

```powershell
git status
git apply --check C:\path\to\access-protection.patch
git apply C:\path\to\access-protection.patch
npm install
```

The patch adds the jose dependency; this repository currently ignores lockfiles.
Do not force the patch if --check fails. Reconcile local changes first.

## 2. Create the Access application BEFORE attaching the admin hostname

In Cloudflare Zero Trust:

1. Open Integrations > Identity providers and add One-time PIN if needed.
2. Open Access controls > Applications > Add an application > Self-hosted.
3. Name it 3F Wallet Admin.
4. Add the public hostname admin-walletpass.3fstriders.org with NO path restriction,
   covering the entire admin hostname, including /api/* and /assets/*.
5. Create an Allow policy. Under Include, select Emails and enter only your
   organizer email addresses. Choose One-time PIN as an application login method.
6. Do not use Include Everyone, or a Bypass policy. An Include rule matching only
   the login method would allow arbitrary email addresses.
7. Save. In the application's Additional settings, copy Application Audience (AUD) Tag.
8. Find your team domain in Zero Trust team settings, such as
   https://your-team.cloudflareaccess.com. This is not the admin hostname.

No Cloudflare Tunnel, WARP installation, participant account, Resend change,
or WalletWallet credential change is needed.

## 3. Fill in wrangler.toml

The patch supplies:

```toml
workers_dev = false
preview_urls = false
```

Keep these at the top level. Under the existing [vars], fill the two blank values:

```toml
PUBLIC_DOMAIN = "https://walletpass.3fstriders.org"
ADMIN_DOMAIN = "https://admin-walletpass.3fstriders.org"
ACCESS_TEAM_DOMAIN = "https://your-team.cloudflareaccess.com"
ACCESS_AUD = "paste-the-admin-application-audience-tag"
```

Use origin URLs only (no path/query), distinct public and admin hostnames, and
the AUD from this exact admin application. These values are public configuration,
not passwords or API keys. Keep them in the checked-in Wrangler file so subsequent
GitHub builds retain them. Do not add them to the participant email template.

## 4. Verify locally, then deploy through GitHub

```powershell
npm run lint
npm test
npm run build
git diff --check
git add package.json worker/adminAccess.ts worker/index.ts wrangler.toml src/components/admin/CloudflareConsoleTab.tsx tests/accessFixture.ts tests/adminAccess.test.ts tests/passDelivery.test.ts ACCESS_SETUP.md
git commit -m "Protect organizer dashboard and APIs with Cloudflare Access"
git push
```

Let the existing Cloudflare GitHub integration build and deploy as usual.
The Worker dashboard remains blocked if you deploy with blank Access variables.
Do not remove the gate to troubleshoot configuration.

## 5. Attach the admin hostname to the SAME Worker

After the patched Worker is deployed and the Access app exists:

1. Cloudflare Workers & Pages > race-wallet-pass > Settings > Domains & Routes.
2. Add a Custom Domain: admin-walletpass.3fstriders.org.
3. Retain the existing walletpass.3fstriders.org domain on this Worker.
4. Confirm the Access application covers the admin hostname.
5. Confirm workers.dev and version preview URLs are disabled.

Do not create another Worker or copy the database. Both custom domains use the
same existing D1, R2, Queue and secrets. Do not put Access in front of the entire
public participant hostname, because that would require participants to log in.
Remove any preexisting whole-host Access application on the participant hostname
once the new routing gate has deployed.

## 6. Check after deployment

Use a private browser window with no existing Access session:

- Public root / and /lookup return 404, with no dashboard.
- Public /api/settings and /api/runners return 404; POST /api/d1/query also returns 404.
- Admin hostname opens Cloudflare's login. Your allowlisted email receives a code
  and can load the dashboard, races, templates, CSV importer and settings.
- An email outside the allowlist cannot enter the app.
- Open an existing participant email link in the private window: it works with no
  Access prompt. Check Apple headers/download, Android redirect and desktop buttons.
- From the admin roster, Copy Link produces the public walletpass hostname.
- Any newly sent participant email uses the public hostname too.
- workers.dev and version preview addresses cannot serve the dashboard or APIs.

Optional read-only PowerShell checks:

```powershell
curl.exe -I https://walletpass.3fstriders.org/
curl.exe -I https://walletpass.3fstriders.org/api/settings
curl.exe -I https://admin-walletpass.3fstriders.org/
```

The first two should be 404. The admin request normally redirects to Access login.

## Troubleshooting and limits

- Admin 503: ACCESS_TEAM_DOMAIN or ACCESS_AUD is blank/invalid. Fill the file,
  commit and push. Participant links continue working.
- Admin 403 after login: check the application AUD and exact team URL, that the
  whole admin hostname is protected, and connectivity to the team's JWKS endpoint.
  Changing applications requires updating ACCESS_AUD. Log out at
  https://admin-walletpass.3fstriders.org/cdn-cgi/access/logout and log back in.
- Admin 404: check ADMIN_DOMAIN, the custom domain attachment and TLS readiness.
- Participants see Access login: an Access application is still covering the
  participant hostname. Public token routes must remain outside Access.
- Public self-service email lookup is intentionally disabled. Organizers can
  resend invitations from the protected dashboard.
- Secure links remain bearer credentials: anyone holding one can access its pass.
- npm run dev is the existing Express UI preview, not the secured production
  Worker. Do not expose that development server publicly. There is no production
  authentication bypass for localhost or tests.

Validation: 42 automated tests, TypeScript and Vite production build passed.
Tests include real signed JWTs, invalid signatures, wrong issuer/audience,
expired/future tokens, missing configuration, blocked public APIs/static assets,
authorized admin assets and existing pass/email/CSV behavior. Live Cloudflare
Access login and real device/email-client checks must be done after setup.

Official references:

- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/
