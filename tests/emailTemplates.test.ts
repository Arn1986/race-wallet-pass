import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPassEmail, validateEmailTemplate, DEFAULT_EMAIL_TEMPLATE, EMAIL_PREVIEW_CONTEXT } from '../server/emailTemplates.ts';

const content = { name: 'Welcome', subject: '{{event_name}} — {{first_name}}', message: 'Hello {{full_name}},\n\nYour bib is {{bib}}. Meet at {{event_location}} in {{wave}}.\nEmergency contact: {{data.emergency_contact}}' };

test('email templates resolve athlete/event/CSV variables and always append the secure wallet CTA', () => {
  const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template: content });
  assert.equal(email.subject, '3F Striders Race — Alex');
  assert.ok(email.html.includes('Alex Rivera')); assert.ok(email.html.includes('Taylor Rivera'));
  assert.ok(email.html.indexOf('Emergency contact:') < email.html.indexOf('Download your wallet pass'));
  assert.ok(email.html.includes(`href="${EMAIL_PREVIEW_CONTEXT.passUrl}"`));
  assert.ok(email.text.endsWith(EMAIL_PREVIEW_CONTEXT.passUrl));
  assert.ok(email.html.includes('If the button does not work'));
  assert.ok(!email.html.includes('walletwallet.dev'));
});

test('editable text and participant values cannot inject HTML or remove the mandatory button', () => {
  const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT,
    template: { name: 'Safe', subject: 'Hello {{first_name}}', message: '<style>a {display:none}</style>\n<script>alert(1)</script>\n{{full_name}}' },
    runner: { ...EMAIL_PREVIEW_CONTEXT.runner, first_name: '<img src=x onerror=alert(1)>', last_name: '& Friend' },
  });
  assert.ok(!email.html.includes('<script>')); assert.ok(!email.html.includes('<style>'));
  assert.ok(email.html.includes('&lt;script&gt;')); assert.ok(email.html.includes('&amp; Friend'));
  assert.ok(email.html.includes('Download your wallet pass'));
});

test('default invitation remains available; subject is text and unsafe URLs/invalid tokens are rejected', () => {
  const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, event: { name: 'Run & Swim' } });
  assert.ok(email.subject.includes('Run & Swim')); assert.ok(!email.subject.includes('&amp;'));
  assert.ok(email.html.includes('Run &amp; Swim')); assert.ok(email.html.includes('Download your wallet pass'));
  for (const patch of [{ name: '' }, { subject: 'Hello\r\nBcc: other@example.com' }, { message: '{{unknown}}' }, { message: '{{first_name' }, { message: '' }]) {
    assert.throws(() => validateEmailTemplate({ ...DEFAULT_EMAIL_TEMPLATE, ...patch }));
  }
  assert.throws(() => renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, passUrl: 'javascript:alert(1)' }), /HTTPS/);
});

test('zero/false CSV values and optional empty fields render predictably; subject newlines are removed', () => {
  const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT,
    runner: { ...EMAIL_PREVIEW_CONTEXT.runner, first_name: 'Alex\r\nInjected', dynamic_data: { bib: 0, paid: false } },
    template: { name: 'Values', subject: '{{first_name}}', message: '{{bib}} / {{data.paid}} / {{data.missing}}' },
  });
  assert.equal(email.subject, 'Alex Injected'); assert.ok(email.text.startsWith('0 / false /'));
});
