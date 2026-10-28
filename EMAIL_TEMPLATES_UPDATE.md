# Reusable event email templates

Prepared against GitHub commit 15d6c33 (the template artwork update).

## Using the feature

1. Open the new **Email Templates** tab.
2. Click **New Template**, then enter its name, email subject, and message.
3. Use the variable buttons to insert participant/event details at the cursor in
   the subject or message. The live preview uses sample data and sends no email.
4. Save the template.
5. When creating an event, choose its Email Template alongside its Pass Design
   Template. For an existing event, select it in Events & Rosters and use the
   event's email-template selector plus **Save Email Template**.

One email template can be selected by multiple events. Editing it changes future
invitations and resends for all assigned events. It does not resend emails by
itself or alter messages already sent. Select **Default wallet invitation** to use
an event without a custom template. A template in use by an event cannot be
deleted until those events select another template or the default.

The subject and message are editable plain text; paragraphs and line breaks are
preserved. HTML is displayed as text. This version does not add a rich-text/image
editor. The existing branded wrapper, event heading, and footer remain.

The **Download your wallet pass** button is always inserted below the custom
message. It cannot be removed or retargeted by template text. A clickable personal
URL is also included beneath the button for email clients where the button fails,
and a plain-text alternative includes the same URL.

## Personalization

Supported variables:

- `{{first_name}}`, `{{last_name}}`, `{{full_name}}`, `{{email}}`
- `{{event_name}}`, `{{event_date}}`, `{{event_location}}`
- `{{bib}}`, `{{wave}}`, `{{category}}`
- `{{data.column_name}}` for an additional athlete CSV/dynamic-data key, using
  letters, digits, and underscores. For example `{{data.emergency_contact}}`.

Bib/wave/category use the same race field mapping as pass issuance. Other data
variables use the exact saved CSV key. Missing optional values render blank.
Event date is the saved event date/time string; the renderer does not guess a
separate timezone or change the event's stored time.

Template name is limited to 100 characters, subject to 200, and message to 10,000.
Unknown variables are rejected before saving. Subjects remain plain text, and
HTML-sensitive message/participant content is escaped so it cannot hide the CTA.

## Delivery integration

The production Worker's central sendPassEmail handler reads the participant's
actual event and its selected template on each send. It is shared by:

- Immediate individual issuance
- CSV/queue issuance
- Organizer resend
- Public lookup/redelivery
- The existing administrator test-email action (using its selected sample athlete)

The button still points to the first-party, random-token URL. No WalletWallet
share URL is rendered and no provider landing page is introduced. Existing
private R2 persistence and device detection remain in effect. Sender domain,
Resend credentials, queue retry behavior, and the pass template selection are
unchanged. Previewing or saving an email template does not send anything.

The Express preview server mirrors CRUD, assignment, and rendering in memory.
Its email templates reset on restart. It remains a development mock and retains
its existing local pass-link behavior; use the Worker for production token links.

## Schema and migration

New tables:

- EmailTemplates: id, name, subject, message, timestamps.
- EventEmailTemplates: race_id -> email_template_id association, one selection
  per event, many events per template.

No existing Races column is altered. API race objects expose email_template_id and
email_template_name through joins. Existing events without an association get the
default invitation. The migration only creates new tables/indexes and is safe to
run repeatedly.

## Apply and deploy

Extract this bundle. From the repository root in PowerShell:

```powershell
git apply --check C:\path\to\email-templates.patch
git apply C:\path\to\email-templates.patch
npm run lint
npm test
npm run build
```

Recommended before deployment:

```powershell
npx wrangler d1 execute wallet_pass_db --remote --file=./migrations/0003_email_templates.sql
```

The tables are also created by Worker initialization on first use, so existing
events continue working if the manual migration has not run. New databases include
the tables in schema.sql. The migration also creates the assignment lookup index.

Commit/push through the existing GitHub-to-Cloudflare deployment pipeline. Keep
/api/email-templates and /api/races/<id>/email-template under the same organizer
access protection as the other administrator APIs. No new binding/secret is needed.

For a manual smoke check after deployment:

1. Create two email templates with different subjects/messages.
2. Assign each to a different test event; also test one shared template on both.
3. Issue a participant pass and confirm the expected personalized message and
   secure Download your wallet pass button.
4. Resend from the roster and test a small CSV import. Both should use the event's
   selected template.
5. Switch one event back to Default and verify its next email uses the default.
6. Preview the message on desktop/mobile and open one controlled test invitation
   in your actual email client. No browser preview or save should send an email.

Validation: 38 automated tests, TypeScript checks, production build, and patch
application against the base commit pass. Tests cover rendering, mandatory CTA
placement, escaping, default fallback, variables, CRUD, event selection/reuse,
delete protection, and individual/queued/resend/lookup delivery with mocked external
services. Real browser automation was attempted but blocked by this runtime's
Chromium socket restrictions; interactive UI and real email-client rendering still
need the manual checks above. No real emails, remote database writes, provider
charges, GitHub push, or Cloudflare deployment were performed.
