import { buildWalletWalletPayload } from './walletPayload.ts';
import { validateEmailDesign, EMAIL_FONTS, emailLogoAttachment, type EmailDesign } from './emailDesign.ts';

export interface EmailTemplateContent { name: string; subject: string; message: string; design?: EmailDesign }
export interface EmailTemplate extends EmailTemplateContent { id: string; event_count?: number; created_at?: string; updated_at?: string }
export const DEFAULT_EMAIL_TEMPLATE: EmailTemplateContent = {
  name: 'Default wallet invitation', subject: 'Your {{event_name}} digital pass is ready',
  message: 'Hello {{first_name}},\n\nYour pass for {{event_name}} is ready! Add it to Apple Wallet or Google Wallet using the button below.\n\nWe look forward to seeing you at the event.\n\n3F Striders',
};
export const EMAIL_VARIABLES = ['first_name', 'last_name', 'full_name', 'email', 'event_name', 'event_date', 'event_location', 'bib', 'wave', 'category'] as const;
const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
export function validateEmailTemplate(input: any): EmailTemplateContent {
  if (!input || typeof input !== 'object') throw new Error('Email template is required');
  const result: any = {};
  for (const [key, max] of [['name', 100], ['subject', 200], ['message', 10_000]] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`${key} is required`);
    if (input[key].length > max) throw new Error(`${key} must be ${max} characters or fewer`);
    result[key] = input[key].trim();
  }
  if (/[\r\n\x00]/.test(result.subject)) throw new Error('Subject must be a single line');
  result.design = validateEmailDesign(input.design);
  for (const text of [result.subject, result.message, result.design.signatureText]) {
    for (const match of text.matchAll(tokenPattern)) {
      const key = match[1].trim();
      if (!(EMAIL_VARIABLES as readonly string[]).includes(key) && !/^data\.[A-Za-z0-9_]+$/.test(key)) throw new Error(`Unknown variable: {{${key}}}`);
    }
    if (/\{\{|\}\}/.test(text.replace(tokenPattern, ''))) throw new Error('Check the {{variable}} syntax');
  }
  return result;
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export function renderPassEmail(options: {
  template?: EmailTemplateContent; passUrl: string; preview?: boolean;
  runner: { id: string; first_name: string; last_name: string; email: string; dynamic_data?: any };
  event: { name: string; event_date?: string; location?: string; field_mapping?: string };
}) {
  const template = validateEmailTemplate(options.template || DEFAULT_EMAIL_TEMPLATE);
  const url = new URL(options.passUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Wallet pass link must use HTTPS');
  const spec = buildWalletWalletPayload({ runner: options.runner, raceName: options.event.name, fieldMapping: options.event.field_mapping });
  let data: any = options.runner.dynamic_data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  const values: Record<string, string> = { first_name: options.runner.first_name, last_name: options.runner.last_name,
    full_name: `${options.runner.first_name} ${options.runner.last_name}`.trim(), email: options.runner.email,
    event_name: options.event.name, event_date: options.event.event_date || '', event_location: options.event.location || '',
    bib: spec.barcodeValue, wave: spec.headerFields[0].value, category: spec.secondaryFields[1].value };
  const interpolate = (text: string) => text.replace(tokenPattern, (_, key: string) => {
    key = key.trim();
    if (key.startsWith('data.')) {
      const field = key.slice(5); return Object.hasOwn(data, field) && ['string', 'number', 'boolean'].includes(typeof data[field]) ? String(data[field]) : '';
    }
    return values[key] || '';
  });
  const subject = interpolate(template.subject).replace(/[\r\n\x00-\x1f]+/g, ' ').slice(0, 200);
  const message = interpolate(template.message);
  const formatText = (text: string) => escape(text).split(/\r?\n\s*\r?\n/).map(p => `<p style="margin:0 0 18px;line-height:1.65">${p.replace(/\r?\n/g, '<br>')}</p>`).join('');
  const paragraphs = formatText(message), design = template.design!;
  const signatureText = interpolate(design.signatureText);
  const attachments = design.logo.startsWith('data:') ? [emailLogoAttachment(design.logo)] : [];
  const logoSrc = attachments.length && !options.preview ? 'cid:email-signature-logo' : design.logo;
  const signature = signatureText || design.logo ? `<div style="padding:4px 0 16px;text-align:${design.signatureAlign}">${signatureText ? formatText(signatureText) : ''}${logoSrc ? `<img src="${escape(logoSrc)}" alt="${escape(design.logoAlt)}" width="${design.logoWidth}" style="display:inline-block;width:${design.logoWidth}px;max-width:100%;height:auto;border:0;vertical-align:middle">` : ''}</div>` : '';
  const radius = design.corners === 'rounded' ? 20 : 0;
  const href = escape(url.href), eventName = escape(options.event.name);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:${design.backgroundColor};font-family:${EMAIL_FONTS[design.fontFamily]};color:${design.textColor};padding:32px 16px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:${design.cardColor};border-radius:${radius}px;overflow:hidden">
  <tr><td bgcolor="${design.headerColor}" style="background:${design.headerColor};padding:28px 24px;text-align:center;color:${design.headerTextColor}"><h1 style="margin:0;font-size:22px;color:${design.headerTextColor}">${eventName}</h1><p style="margin:8px 0 0;color:${design.headerTextColor}">Your digital wallet pass</p></td></tr>
  <tr><td bgcolor="${design.cardColor}" style="padding:28px 24px;background:${design.cardColor};font-size:${design.fontSize}px;color:${design.textColor};overflow-wrap:anywhere">${paragraphs}${signature}
  <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:12px auto 24px"><tr><td align="center" bgcolor="${design.buttonColor}" style="background:${design.buttonColor};border-radius:${radius ? 12 : 0}px;mso-padding-alt:16px 28px"><a href="${href}" style="display:inline-block;padding:16px 28px;background:${design.buttonColor};color:${design.buttonTextColor};border-radius:${radius ? 12 : 0}px;font-family:${EMAIL_FONTS[design.fontFamily]};font-size:16px;font-weight:bold;text-decoration:none">Download your wallet pass</a></td></tr></table>
  <p style="font-size:12px;line-height:1.6;color:${design.textColor}">If the button does not work, open your personal link:<br><a href="${href}" style="color:${design.linkColor};word-break:break-all">${href}</a></p></td></tr>
  <tr><td style="padding:18px 24px;text-align:center;font-size:12px;color:${design.textColor}">${eventName} · 3F Striders</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text: `${message}${signatureText ? `\n\n${signatureText}` : ''}\n\nDownload your wallet pass:\n${url.href}`, attachments };
}

export const EMAIL_PREVIEW_CONTEXT = { passUrl: 'https://walletpass.3fstriders.org/preview-only',
  runner: { id: 'preview-athlete', first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.com', dynamic_data: { bib: '1001', wave: 'Wave A', category: '10K', emergency_contact: 'Taylor Rivera' } },
  event: { name: '3F Striders Race', event_date: '2026-12-05 07:00', location: 'Dubai' } };
