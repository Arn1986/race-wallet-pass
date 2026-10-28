import React, { useEffect, useRef, useState } from 'react';
import { EMAIL_COLOR_LABELS, EMAIL_FONTS, EMAIL_THEMES, MAX_EMAIL_LOGO_BYTES, emailLogoAttachment,
  type EmailDesign } from '../../../server/emailDesign.ts';

const inputClass = 'mt-2 block w-full rounded-xl p-3 bg-slate-950 border border-slate-700 text-white';
export function EmailDesignEditor({ value, onChange, disabled, onBusyChange }: {
  value: EmailDesign; onChange: (value: EmailDesign) => void; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [reading, setReading] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onBusyChange(false); }; }, [onBusyChange]);
  const update = <K extends keyof EmailDesign>(key: K, next: EmailDesign[K]) => onChange({ ...value, [key]: next });
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Choose a PNG or JPEG image.'); return; }
    if (file.size > MAX_EMAIL_LOGO_BYTES) { setError('Choose an image of 256 KB or smaller.'); return; }
    setReading(true); onBusyChange(true);
    try {
      const logo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read this image. Please try again.'));
        reader.onabort = () => reject(new Error('Image selection was cancelled.'));
        reader.readAsDataURL(file);
      });
      emailLogoAttachment(logo);
      if (alive.current) update('logo', logo);
    } catch (err: any) { if (alive.current) setError(err.message); }
    finally { if (alive.current) { setReading(false); onBusyChange(false); } }
  };
  return <fieldset disabled={disabled || reading} className="space-y-4 border-t border-slate-700 pt-5 disabled:opacity-70">
    <legend className="font-semibold text-white px-1">Email style & signature</legend>
    <div><p className="text-xs text-slate-400 mb-2">Apply a color theme (keeps your signature and typography):</p>
      <div className="flex flex-wrap gap-2">{Object.entries(EMAIL_THEMES).map(([name, theme]) => <button key={name} type="button"
        onClick={() => { const colors = Object.fromEntries(Object.keys(EMAIL_COLOR_LABELS).map(key => [key, theme[key as keyof typeof EMAIL_COLOR_LABELS]])); onChange({ ...value, ...colors }); }}
        className="px-3 py-2 rounded-lg border border-slate-600 text-sm text-white">{name}</button>)}</div></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Object.entries(EMAIL_COLOR_LABELS).map(([key, label]) => <label key={key} className="text-xs text-slate-300">{label}
      <div className="flex gap-2 mt-2"><input aria-label={`${label} picker`} type="color" value={/^#[0-9a-f]{6}$/i.test(value[key as keyof typeof EMAIL_COLOR_LABELS]) ? value[key as keyof typeof EMAIL_COLOR_LABELS] : '#000000'}
        onChange={event => update(key as keyof typeof EMAIL_COLOR_LABELS, event.target.value)} className="h-10 w-12 rounded bg-slate-950 border border-slate-700" />
        <input aria-label={`${label} hex`} maxLength={7} value={value[key as keyof typeof EMAIL_COLOR_LABELS]} onChange={event => update(key as keyof typeof EMAIL_COLOR_LABELS, event.target.value)} className="w-full min-w-0 rounded-lg px-2 bg-slate-950 border border-slate-700 text-white font-mono" /></div>
    </label>)}</div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label className="text-xs text-slate-300">Font<select value={value.fontFamily} onChange={event => update('fontFamily', event.target.value as EmailDesign['fontFamily'])} className={inputClass}>{Object.keys(EMAIL_FONTS).map(font => <option key={font} value={font}>{font[0].toUpperCase() + font.slice(1)}</option>)}</select></label>
      <label className="text-xs text-slate-300">Text size<select value={value.fontSize} onChange={event => update('fontSize', Number(event.target.value))} className={inputClass}>{[14, 15, 16, 17, 18, 19, 20].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label className="text-xs text-slate-300">Corners<select value={value.corners} onChange={event => update('corners', event.target.value as EmailDesign['corners'])} className={inputClass}><option value="rounded">Rounded</option><option value="square">Square</option></select></label>
    </div>
    <label className="block text-sm text-slate-300">Signature text (optional)<textarea rows={3} maxLength={2000} value={value.signatureText} onChange={event => update('signatureText', event.target.value)} placeholder={'Best regards,\n3F Striders Team'} className={inputClass} /></label>
    <p className="text-xs text-slate-400">Signature text supports the same variables as your message. The optional logo appears below the signature text and above the wallet button.</p>
    <label className="block text-sm text-slate-300">Signature logo URL (optional)<input type="url" value={value.logo.startsWith('data:') ? '' : value.logo} onChange={event => { setError(''); update('logo', event.target.value); }} placeholder="https://example.com/logo.png" className={inputClass} /></label>
    <label className="block text-sm text-slate-300">Or browse for a logo<input type="file" accept="image/png,image/jpeg" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} className="mt-2 block w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:p-2 file:text-white" /></label>
    <p className="text-xs text-slate-400">PNG or JPEG, maximum 256 KB. Uploaded logos are embedded in the email. URL images must be publicly accessible over HTTPS.</p>
    {reading && <p role="status" className="text-sky-300 text-sm">Reading logo…</p>}
    {error && <p role="alert" className="text-rose-300 text-sm">{error}</p>}
    {value.logo && <div className="flex items-center gap-3"><span className="text-xs text-slate-300">{value.logo.startsWith('data:') ? 'Uploaded logo selected' : 'Logo URL selected'}</span><button type="button" onClick={() => { setError(''); update('logo', ''); }} className="text-xs text-rose-300 underline">Remove logo</button></div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="text-xs text-slate-300">Logo width<select value={value.logoWidth} onChange={event => update('logoWidth', Number(event.target.value))} className={inputClass}>{[80, 120, 160, 200, 240, 280, 320].map(width => <option key={width} value={width}>{width} px</option>)}</select></label>
      <label className="text-xs text-slate-300">Signature alignment<select value={value.signatureAlign} onChange={event => update('signatureAlign', event.target.value as EmailDesign['signatureAlign'])} className={inputClass}><option value="left">Left</option><option value="center">Center</option></select></label>
    </div>
    <label className="block text-xs text-slate-300">Logo alternative text<input maxLength={100} value={value.logoAlt} onChange={event => update('logoAlt', event.target.value)} className={inputClass} /></label>
    <p className="text-xs text-slate-400">Your email app may adjust fonts, colors or image display. Text and button colors need enough contrast to remain readable.</p>
  </fieldset>;
}
