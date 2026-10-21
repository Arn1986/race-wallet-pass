# Optional template artwork and sharing controls

Prepared against GitHub commit 0a3e3c6 (fix bulk csv import).

Pass Studio now has a Wallet sharing selector with two explicit values:

- sharingProhibited: false allows the Apple Wallet share button.
- sharingProhibited: true hides that button.

Each template retains its own value. Existing app defaults are preserved.
This setting controls the installed wallet's share UI, not the separate bearer link
in a recipient's email.

Optional artwork fields:

| Field | Purpose | Recommended size |
| --- | --- | --- |
| logoURL | Logo on the pass face | 160 × 160 px |
| iconURL | Apple notification/lock-screen icon | 120 × 120 px |
| thumbnailURL | Top-right pass image | 180 × 180 px |
| backgroundURL | Poster artwork; device-dependent layout | 690 × 1010 px |

Each field accepts a public HTTPS URL or a browsed PNG/JPEG/WebP file. PNG files
are retained as PNG data URIs; JPEG/WebP is converted to PNG in the browser before
saving. The file is stored with the template schema in D1 and sent directly to
WalletWallet, so no new bucket, upload endpoint, or database column is required.

Clear removes the optional image from future issuance. Blank fields are omitted
from the provider request. Images require WalletWallet Pro or Business; Free
continues to work with all optional artwork blank. To issue with paid artwork,
set the app's existing WalletWallet plan setting to Pro (also for a Business key).
The integration never silently removes configured paid artwork from a Free request.

The implementation uses WalletWallet's documented case-sensitive field names and
boolean sharing flag: https://www.walletwallet.dev/docs/

## Limits and previews

The browser checks files before saving. Each input/converted PNG must be under
1 MB. The combined encoded template is capped at 1.8 MB to stay within D1 and
provider payload limits; the final WalletWallet JSON request also has a 2 MB check.
Use small artwork or public HTTPS URLs when combining multiple large images.
URL image size/content/public accessibility is validated by WalletWallet at issuance.

Individual image previews are shown in the editor. The logo is also used by both
card previews. The pass-face preview is illustrative; it does not emulate every
poster/thumbnail layout or notification surface across devices. Saving is disabled
while a file is being read/converted. Switching templates resets the artwork and
ignores an upload that finishes after its original template was left.

Artwork lives in schema_definition using logoURL, iconURL, thumbnailURL, and
backgroundURL. Older logo/background columns are recognized when canonical fields
are absent. Explicit blank fields override legacy values, so Clear works on older
templates too. Existing strip artwork is preserved by the shared payload builder.

## Apply

Extract this bundle, then from your repository root in PowerShell:

```powershell
git apply --check C:\path\to\template-artwork.patch
git apply C:\path\to\template-artwork.patch
npm run lint
npm test
npm run build
```

Commit/push through your existing GitHub-to-Cloudflare pipeline. No migration or
new binding is needed.

After deployment, save a template, switch away/back, and check sharing plus the
four images. For a Free-tier test, leave all artwork blank. For a paid test, add
an HTTPS image or browse a file, save, and issue a fresh test pass assigned to
that template. Saving alone does not replace already-issued R2 packages or push
a template update to every installed pass.

Validation: 31 automated tests, TypeScript checks, and production build pass.
Tests cover sharing true/false, all four wire fields, template persistence and
immediate issuance, blank clearing/legacy fallback, Free-tier compatibility,
HTTPS/PNG validation, and size limits. External services were mocked; no paid
provider call, real file upload in a browser, wallet installation, remote write,
GitHub push, or Cloudflare deployment was performed.
