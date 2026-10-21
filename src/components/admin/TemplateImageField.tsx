import React, { useEffect, useRef, useState } from 'react';
import { MAX_IMAGE_BYTES, normalizeArtwork } from '../../../server/templateArtwork.ts';

export async function fileToPng(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Choose a file smaller than 1 MB');
  if (file.type === 'image/png') {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
    return normalizeArtwork(data, 'Image');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image conversion is unavailable in this browser');
    context.drawImage(img, 0, 0);
    return normalizeArtwork(canvas.toDataURL('image/png'), 'Converted PNG');
  } finally { URL.revokeObjectURL(url); }
}

export function TemplateImageField({ field, description, value, onChange, disabled, onBusyChange }: {
  field: string; description: string; value: string; onChange: (value: string) => void; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  let validation = '';
  try { normalizeArtwork(value, field); } catch (err: any) { validation = err.message; }
  const inline = value.trim().startsWith('data:');
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 space-y-2">
    <label className="block text-xs font-semibold text-white" htmlFor={`artwork-${field}`}>{field} <span className="font-normal text-slate-400">(optional)</span></label>
    <p className="text-[11px] text-slate-400">{description}</p>
    <input id={`artwork-${field}`} type="url" value={inline ? '' : value} placeholder={inline ? 'PNG file attached — paste a URL to replace it' : 'https://example.com/image.png'}
      onChange={event => { setError(''); onChange(event.target.value); }} disabled={disabled || busy}
      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs" />
    <div className="flex items-center gap-2 flex-wrap">
      <label className="cursor-pointer rounded-lg bg-slate-800 px-3 py-2 text-xs text-sky-300">{busy ? 'Reading image…' : 'Browse file'}
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Browse file for ${field}`} className="sr-only" disabled={disabled || busy}
          onChange={async event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
            setBusy(true); onBusyChange(true); setError('');
            try { const png = await fileToPng(file); if (alive.current) onChange(png); }
            catch (err: any) { if (alive.current) setError(err.message); }
            finally { if (alive.current) setBusy(false); onBusyChange(false); }
          }} />
      </label>
      {!!value && <button type="button" disabled={disabled || busy} onClick={() => { onChange(''); setError(''); }} className="px-3 py-2 text-xs text-slate-400">Clear</button>}
      {inline && <span className="text-xs text-emerald-300">PNG file attached</span>}
    </div>
    {(error || validation) && <p role="alert" className="text-xs text-red-300">{error || validation}</p>}
    {!!value && !validation && <img src={value} alt={`${field} preview`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.alt = 'Image could not be loaded; check the public URL'; }} className="max-h-24 max-w-full rounded-lg object-contain" />}
  </div>;
}
