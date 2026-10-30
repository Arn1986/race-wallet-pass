import React, { useEffect, useState } from 'react';

export function PublicLookupSettings({ raceId }: { raceId: string }) {
  const [slug, setSlug] = useState(''), [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState<string | null>(null), [savedEnabled, setSavedEnabled] = useState(false);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`/api/races/${encodeURIComponent(raceId)}/lookup-page`).then(async response => {
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not load lookup page settings');
      if (active) { setSlug(json.data.slug); setEnabled(json.data.enabled); setSavedEnabled(json.data.enabled); setUrl(json.data.public_url); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [raceId]);
  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/races/${encodeURIComponent(raceId)}/lookup-page`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, enabled }) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not save lookup page');
      setSlug(json.data.slug); setEnabled(json.data.enabled); setSavedEnabled(json.data.enabled); setUrl(json.data.public_url);
      setNotice(json.data.enabled ? 'Public lookup page enabled.' : 'Lookup page disabled. Existing secure pass links keep working.');
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
    <h3 className="font-bold text-white">Public pass lookup page</h3>
    <p className="text-sm text-slate-400">Give participants a page where they enter their first name, last name and email to open their ready wallet pass for this event.</p>
    <label className="flex items-center gap-2 text-sm font-semibold text-white"><input type="checkbox" checked={enabled} disabled={loading || saving} onChange={event => { setEnabled(event.target.checked); setNotice(''); }} />Enable public lookup for this event</label>
    <label className="block text-sm text-slate-300">URL slug<input value={slug} disabled={loading || saving} onChange={event => { setSlug(event.target.value); setNotice(''); }} maxLength={60} placeholder="striders-race-2026" className="block w-full mt-2 rounded-xl p-3 bg-slate-950 border border-slate-700 text-white" /></label>
    <p className="text-xs text-slate-400">Use 3–60 letters, numbers or hyphens. Each event needs a unique slug. Save your changes to publish or disable the page.</p>
    <p className="text-xs text-amber-200">Anyone who knows a participant’s registered name and email can access their pass while this page is enabled. No email verification code is required.</p>
    <button type="button" onClick={save} disabled={loading || saving || !slug.trim()} className="px-4 py-3 rounded-xl bg-sky-500 text-slate-950 font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save Lookup Page'}</button>
    {url && <div className="text-sm text-slate-300 break-all"><p>{savedEnabled ? 'Published URL:' : 'Saved URL (currently disabled):'}</p>{savedEnabled ? <a href={url} target="_blank" rel="noreferrer" className="text-sky-300 underline">{url}</a> : <span>{url}</span>}
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setNotice('Lookup URL copied.'); } catch { setError('Could not copy. Select and copy the URL above.'); } }} className="ml-3 text-sky-300 underline">Copy URL</button></div>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
  </section>;
}
