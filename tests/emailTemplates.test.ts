import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPassEmail, validateEmailTemplate, DEFAULT_EMAIL_TEMPLATE, EMAIL_PREVIEW_CONTEXT } from '../server/emailTemplates.ts';
import { EMAIL_THEMES, DEFAULT_EMAIL_DESIGN, validateEmailDesign, MAX_EMAIL_LOGO_BYTES } from '../server/emailDesign.ts';

const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=';

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

test('themes, typography and signature render before the mandatory wallet CTA', () => {
  for (const theme of Object.values(EMAIL_THEMES)) {
    const design = { ...theme, fontFamily: 'georgia' as const, fontSize: 18, corners: 'square' as const,
      signatureText: 'Best regards,\n{{event_name}} team\n{{data.emergency_contact}}', signatureAlign: 'center' as const,
      logo: 'https://example.com/logo.png', logoWidth: 240, logoAlt: 'Team & friends' };
    const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template: { ...content, design } });
    for (const color of [design.backgroundColor, design.cardColor, design.headerColor, design.buttonColor]) assert.ok(email.html.includes(color));
    assert.ok(email.html.includes('font-family:Georgia,Times,serif'));
    assert.ok(email.html.includes('font-size:18px'));
    assert.ok(email.html.includes('border-radius:0px'));
    assert.ok(email.html.includes('width="240"'));
    assert.ok(email.html.includes('alt="Team &amp; friends"'));
    assert.ok(email.html.indexOf('Best regards,') < email.html.indexOf('<img'));
    assert.ok(email.html.indexOf('<img') < email.html.indexOf('Download your wallet pass'));
    assert.ok(email.text.includes('Best regards,\n3F Striders Race team\nTaylor Rivera'));
    assert.equal(email.attachments.length, 0);
  }
});

test('uploaded logo uses a real CID attachment for sending and a data image only in preview', () => {
  const template = { ...content, design: { ...DEFAULT_EMAIL_DESIGN, logo } };
  const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template });
  assert.ok(email.html.includes('src="cid:email-signature-logo"'));
  assert.ok(!email.html.includes('data:image'));
  assert.deepEqual(email.attachments, [{ filename: 'signature-logo.png', content: logo.split(',')[1], content_type: 'image/png', content_id: 'email-signature-logo' }]);
  const preview = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template, preview: true });
  assert.ok(preview.html.includes(`src="${logo}"`));
  assert.ok(!preview.html.includes('src="cid:'));
  const jpg = validateEmailDesign({ logo: 'data:image/jpeg;base64,/9j/2Q==' });
  assert.equal(renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template: { ...content, design: jpg } }).attachments[0].filename, 'signature-logo.jpg');
});

test('unsafe styling, unreadable colors, oversized and disguised images are rejected', () => {
  for (const design of [
    { buttonColor: '#ffffff', buttonTextColor: '#ffffff' }, { textColor: DEFAULT_EMAIL_DESIGN.cardColor },
    { backgroundColor: 'red;display:none' }, { fontFamily: 'Arial;display:none' }, { fontSize: 0 }, { logoWidth: 999 },
    { corners: 'hidden' }, { signatureAlign: 'right;display:none' }, { logo: 'javascript:alert(1)' },
    { logo: 'http://example.com/logo.png' }, { logo: 'https://user:password@example.com/logo.png' },
    { logo: 'data:image/svg+xml;base64,AAAA' }, { logo: 'data:image/png;base64,YWJjZA==' },
    { logo: 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(MAX_EMAIL_LOGO_BYTES)]).toString('base64') },
  ]) assert.throws(() => validateEmailDesign(design));
  assert.throws(() => validateEmailTemplate({ ...content, design: { signatureText: '{{typo}}' } }));
  assert.throws(() => validateEmailTemplate({ ...content, design: { signatureText: '{{first_name' } }));
});

test('legacy content keeps default colors; optional signature content is escaped and removable', () => {
  assert.deepEqual(validateEmailTemplate(content).design, DEFAULT_EMAIL_DESIGN);
  const template = { ...content, design: { ...DEFAULT_EMAIL_DESIGN, signatureText: '<script>hide()</script> {{full_name}}', logo: '' } };
  const email = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template });
  assert.ok(email.html.includes('&lt;script&gt;hide()&lt;/script&gt; Alex Rivera'));
  assert.ok(!email.html.includes('<script>'));
  assert.ok(!email.html.includes('<img'));
  assert.equal(email.attachments.length, 0);
  assert.ok(email.html.includes('Download your wallet pass'));
});
