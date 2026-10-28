# Email colors, typography and signature logos

Based on race-wallet-pass commit cf889ee (the working Cloudflare Access setup).
This patch preserves your corrected Access configuration and participant URLs.

## What you can customize

Open the protected admin site > Email Templates > select or create a template.
The new Email style & signature panel includes:

- 3F Dark, Clean Light and Purple theme presets.
- Separate colors for the page, message panel, header, body text, wallet button
  and fallback link. Use the picker or a six-digit hex color.
- Arial, Verdana or Georgia, text size 14–20 px, rounded or square corners.
- Optional signature text, with the same participant/event/CSV variables.
- Optional signature logo: paste a public HTTPS image URL, or browse for PNG/JPEG
  up to 256 KB. You can remove the logo or leave it blank.
- Signature alignment, logo display width and alternative text.
- Live preview with sample athlete/event data, including uploaded logos.

Theme presets change colors while preserving your signature, logo and typography.
Color pairs need at least 4.5:1 contrast so the message, header, button and fallback
link remain readable. If a custom pair has low contrast, adjust either color or
choose a preset before saving. The preview explains invalid settings.

The email order is: event header > message > optional signature text > optional
signature logo > mandatory Download your wallet pass button > personal fallback
link. The button and its secure URL remain automatic and visible.

If your current message already ends in a sign-off, you can move that text into
the new Signature text field to avoid duplication. Keep either field blank if you
do not need a separate signature block. The main message is still required.

Styling and the signature are per template. Assign the template to an event as
before. Editing a shared template affects future sends for all assigned events;
it does not resend previous emails. Text and signature use plain paragraphs and
line breaks, not arbitrary HTML or a rich-text editor.

## How logos are sent

Uploaded PNG/JPEG bytes are saved with the template in D1, then sent through Resend
as a base64 attachment with content_id. The email body references that attachment
with cid:email-signature-logo. They are not published in R2 or on a new public
endpoint. The public Worker still accepts only secure pass-token routes.

The editor uses a data image for preview only. Real outgoing email HTML uses CID,
not a data URL. Primary sends, sender fallback retries, individual sends, roster
resends and bulk queue emails all include the same style and attachment data.
Plain-text emails include signature text and the wallet link.

For URL logos, use a direct publicly accessible HTTPS image address, preferably
PNG or JPEG. Do not use an admin site URL protected by Access, a local file path,
or a private R2 object. URL logos are referenced as images and are not downloaded
by the Worker. Uploaded logos avoid the need to host an image publicly.

Email applications can alter dark-mode colors, fall back to another font, square
off rounded corners, or block images. A logo is optional and never replaces the
text or wallet link. Test a real email in the mail apps your participants use.

Resend inline-image reference:
https://resend.com/changelog/embed-images-using-cid

## Apply locally (PowerShell)

Extract this ZIP OUTSIDE the repository. It contains only a patch and this guide,
so it will not introduce a duplicate TypeScript source tree.

From your repository directory:

```powershell
git status
git apply --check C:\path\to\email-style-signature.patch
git apply C:\path\to\email-style-signature.patch
npm run lint
npm test
npm run build
```

If --check fails, reconcile your local changes before applying. No new npm
dependency is introduced; run npm install only if the existing dependencies are
not installed.

## Database

This adds a small EmailTemplateDesigns table related to EmailTemplates. Existing
template rows and event assignments are retained. The Worker creates the table
automatically when initializing email templates, including when sending queued
emails. Manual migration is not required for the normal rollout.

For environments where you explicitly manage SQL migrations, the patch also
includes migrations/0004_email_template_designs.sql. It only uses CREATE TABLE IF
NOT EXISTS, so it can safely run before or after the automatic initialization:

```powershell
npx wrangler d1 execute wallet_pass_db --remote --file=./migrations/0004_email_template_designs.sql
```

Older templates with no design row use the default theme. Existing API clients
that update only name, subject and message preserve the current design. An
explicit design: null resets the design and signature to defaults.

## Publish through your normal workflow

After reviewing and testing locally:

```powershell
git add server/emailDesign.ts server/emailTemplates.ts server.ts worker/emailTemplateStore.ts worker/index.ts src/components/admin/EmailDesignEditor.tsx src/components/admin/EmailTemplatesTab.tsx schema.sql migrations/0004_email_template_designs.sql tests/emailTemplates.test.ts tests/passDelivery.test.ts EMAIL_STYLE_UPDATE.md
git commit -m "Add email template styling and signature logos"
git push
```

Let the existing GitHub integration build and deploy to Cloudflare. No Access,
custom-domain, Worker binding or WalletWallet configuration changes are needed.

## Verify after deployment

1. Open Email Templates on the admin hostname and edit an existing template.
2. Apply Clean Light, change the font and add a signature with {{event_name}}.
3. Browse for a small logo. Confirm it appears above the wallet button in preview.
4. Save, select another template and return. Confirm colors, signature and logo
   persist. Check that unrelated templates retain their own designs.
5. Send one test invitation from an event using this template. Check its colors,
   inline logo and wallet button on desktop and phone. Also test the plain-text
   alternative and an email client with images blocked.
6. Remove the logo or switch to a public HTTPS image URL and send another test.
7. Confirm the public homepage/APIs remain blocked and existing secure pass links
   still work without an organizer login.

Validation completed: 48 automated tests, TypeScript, Vite production build,
Worker browser-target bundle and whitespace checks passed. Tests cover design
persistence, automatic upgrade from the previous schema, older text-only API
updates, logo removal, input validation, signature escaping, CID attachments in
primary/fallback/queued sends, and existing Access/pass/import behavior.

No live email was sent and no remote deployment or D1 change was performed.
Browser and real mail-client checks remain part of the deployment smoke test.
