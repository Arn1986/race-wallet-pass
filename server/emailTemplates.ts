import { buildWalletWalletPayload } from './walletPayload.ts';

export interface EmailTemplateContent { name: string; subject: string; message: string }
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
  for (const text of [result.subject, result.message]) {
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
  template?: EmailTemplateContent; passUrl: string;
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
  const paragraphs = escape(message).split(/\r?\n\s*\r?\n/).map(p => `<p style="margin:0 0 18px;line-height:1.65">${p.replace(/\r?\n/g, '<br>')}</p>`).join('');
  const href = escape(url.href), eventName = escape(options.event.name);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#0f172a;font-family:Arial,sans-serif;color:#f8fafc;padding:32px 16px">
  <div style="max-width:560px;margin:auto;background:#1e293b;border:1px solid #334155;border-radius:20px;overflow:hidden">
  <div style="background:#0369a1;padding:28px 24px;text-align:center"><h1 style="margin:0;font-size:22px;color:#fff">${eventName}</h1><p style="margin:8px 0 0;color:#e0f2fe">Your digital wallet pass</p></div>
  <div style="padding:28px 24px"><div style="font-size:15px;color:#e2e8f0;overflow-wrap:anywhere">${paragraphs}</div>
  <div style="text-align:center;padding:12px 0 24px"><a href="${href}" style="display:inline-block;padding:16px 28px;background:#38bdf8;color:#0f172a;border-radius:12px;font-size:16px;font-weight:bold;text-decoration:none">Download your wallet pass</a></div>
  <p style="font-size:12px;line-height:1.6;color:#94a3b8">If the button does not work, open your personal link:<br><a href="${href}" style="color:#38bdf8;word-break:break-all">${href}</a></p></div>
  <div style="padding:18px 24px;background:#0f172a;text-align:center;font-size:12px;color:#94a3b8">${eventName} · 3F Striders</div></div></body></html>`;
  return { subject, html, text: `${message}\n\nDownload your wallet pass:\n${url.href}` };
}

export const EMAIL_PREVIEW_CONTEXT = { passUrl: 'https://walletpass.3fstriders.org/preview-only',
  runner: { id: 'preview-athlete', first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.com', dynamic_data: { bib: '1001', wave: 'Wave A', category: '10K', emergency_contact: 'Taylor Rivera' } },
  event: { name: '3F Striders Race', event_date: '2026-12-05 07:00', location: 'Dubai' } };
