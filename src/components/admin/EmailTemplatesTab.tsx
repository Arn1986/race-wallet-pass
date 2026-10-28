import React, { useEffect, useRef, useState } from 'react';
import { Mail, Plus, Save, Trash2 } from 'lucide-react';
import { DEFAULT_EMAIL_TEMPLATE, EMAIL_VARIABLES, EMAIL_PREVIEW_CONTEXT, renderPassEmail, validateEmailTemplate,
  type EmailTemplate, type EmailTemplateContent } from '../../../server/emailTemplates.ts';

export function EmailTemplatesTab() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<EmailTemplateContent>({ ...DEFAULT_EMAIL_TEMPLATE, name: 'Wallet pass invitation' });
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [activeField, setActiveField] = useState<'subject' | 'message'>('message');
  const subjectRef = useRef<HTMLInputElement>(null), messageRef = useRef<HTMLTextAreaElement>(null);
  const load = async () => {
    const response = await fetch('/api/email-templates');
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Could not load email templates');
    setTemplates(json.data); return json.data as EmailTemplate[];
  };
  const select = (template?: EmailTemplate) => {
    setSelectedId(template?.id || ''); setForm(template ? { name: template.name, subject: template.subject, message: template.message } : { ...DEFAULT_EMAIL_TEMPLATE, name: 'New email template' });
    setError(''); setNotice('');
  };
  useEffect(() => {
    load().then(rows => { if (rows[0]) select(rows[0]); }).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);
  const update = (field: keyof EmailTemplateContent, value: string) => { setForm(previous => ({ ...previous, [field]: value })); setNotice(''); };
  const insertVariable = (variable: string) => {
    const element = activeField === 'subject' ? subjectRef.current : messageRef.current;
    const start = element?.selectionStart ?? form[activeField].length, end = element?.selectionEnd ?? start;
    const token = `{{${variable}}}`;
    update(activeField, form[activeField].slice(0, start) + token + form[activeField].slice(end));
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length); });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const content = validateEmailTemplate(form);
      const response = await fetch(`/api/email-templates${selectedId ? `/${selectedId}` : ''}`, { method: selectedId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(content) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not save email template');
      await load(); select(json.data); setNotice('Email template saved. Select it in Events & Rosters to use it.');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selectedId) return; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/email-templates/${selectedId}`, { method: 'DELETE' });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not delete email template');
      await load(); select(); setNotice('Email template deleted.');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  let preview: ReturnType<typeof renderPassEmail> | null = null, previewError = '';
  try { preview = renderPassEmail({ ...EMAIL_PREVIEW_CONTEXT, template: form }); } catch (err: any) { previewError = err.message; }
  const current = templates.find(template => template.id === selectedId);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-white flex items-center gap-2"><Mail size={20} />Email Templates</h2><p className="text-sm text-slate-400 mt-1">Create reusable invitations and select one for each event.</p></div>
      <button type="button" disabled={busy} onClick={() => select()} className="flex gap-2 items-center bg-sky-500 text-slate-950 px-4 py-2 rounded-xl font-semibold"><Plus size={16} />New Template</button></div>
    {error && <p role="alert" className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-300">{error}</p>}
    {notice && <p role="status" className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-800 text-emerald-300">{notice}</p>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <form onSubmit={save} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
        <label className="block text-sm text-slate-300">Saved email template<select value={selectedId} disabled={busy || loading} onChange={event => select(templates.find(template => template.id === event.target.value))} className="mt-2 block w-full rounded-xl p-3 bg-slate-950 border border-slate-700 text-white"><option value="">New template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label className="block text-sm text-slate-300">Template name<input required maxLength={100} value={form.name} disabled={busy} onChange={event => update('name', event.target.value)} className="mt-2 block w-full rounded-xl p-3 bg-slate-950 border border-slate-700 text-white" /></label>
        <label className="block text-sm text-slate-300">Email subject<input ref={subjectRef} required maxLength={200} value={form.subject} disabled={busy} onFocus={() => setActiveField('subject')} onChange={event => update('subject', event.target.value)} className="mt-2 block w-full rounded-xl p-3 bg-slate-950 border border-slate-700 text-white" /></label>
        <label className="block text-sm text-slate-300">Your message<textarea ref={messageRef} required maxLength={10_000} rows={12} value={form.message} disabled={busy} onFocus={() => setActiveField('message')} onChange={event => update('message', event.target.value)} className="mt-2 block w-full rounded-xl p-3 bg-slate-950 border border-slate-700 text-white leading-relaxed" /></label>
        <div className="space-y-2"><p className="text-xs text-slate-400">Insert a variable into the {activeField === 'subject' ? 'subject' : 'message'}:</p><div className="flex flex-wrap gap-2">{EMAIL_VARIABLES.map(variable => <button key={variable} type="button" disabled={busy} onClick={() => insertVariable(variable)} className="rounded-lg bg-slate-800 text-sky-300 px-2 py-1 text-xs font-mono">{'{{' + variable + '}}'}</button>)}</div></div>
        <p className="text-xs text-slate-400">Messages use plain text with paragraphs and line breaks. For other athlete data, use a CSV key such as <code>{'{{data.emergency_contact}}'}</code>. Missing optional data appears blank.</p>
        <div className="rounded-xl bg-sky-950/40 border border-sky-900 p-4 text-sm text-sky-200">The “Download your wallet pass” button is added automatically below your message. Its personal URL cannot be removed or changed here.</div>
        <div className="flex gap-3"><button type="submit" disabled={busy || loading} className="flex items-center gap-2 rounded-xl bg-sky-500 text-slate-950 px-4 py-3 font-bold disabled:opacity-50"><Save size={16} />{busy ? 'Saving…' : 'Save Email Template'}</button>
          {selectedId && <button type="button" disabled={busy || !!current?.event_count} onClick={remove} title={current?.event_count ? 'Change event assignments before deleting' : 'Delete email template'} className="flex items-center gap-2 rounded-xl bg-slate-800 text-rose-300 px-4 py-3 disabled:opacity-40"><Trash2 size={16} />Delete</button>}</div>
        {!!current?.event_count && <p className="text-xs text-slate-400">Selected by {current.event_count} event(s). Editing changes future emails for all of them.</p>}
      </form>
      <div className="space-y-3"><h3 className="font-bold text-white">Email Preview</h3><p className="text-xs text-slate-400">Sample athlete and event data. No email is sent; the preview button is disabled.</p>
        {preview ? <><p className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-sm text-slate-300"><strong>Subject:</strong> {preview.subject}</p><iframe title="Wallet invitation email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} className="w-full h-[700px] rounded-2xl border border-slate-800 bg-slate-950" style={{ pointerEvents: 'none' }} /></> : <p className="text-amber-300 text-sm">{previewError}</p>}
      </div>
    </div>
  </div>;
}
