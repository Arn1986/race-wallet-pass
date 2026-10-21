import React, { useEffect, useState } from 'react';
import { Upload, Download, FileText, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Race } from '../../types/index.ts';
import { MAX_IMPORT_ROWS, SAMPLE_ATHLETES_CSV, parseAthleteCsv, type ImportIssue } from '../../../server/csvImport.ts';

interface CsvUploaderTabProps {
  onOpenRunnerPass: (runnerId: string) => void;
  onNavigateTab: (tab: string) => void;
}

async function jsonResponse(response: Response) {
  const json: any = await response.json().catch(() => { throw new Error('The server did not return JSON. Check that the Worker API is deployed.'); });
  return json;
}

export const CsvUploaderTab: React.FC<CsvUploaderTabProps> = ({ onNavigateTab }) => {
  const [races, setRaces] = useState<Race[]>([]);
  const [raceId, setRaceId] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [batchId, setBatchId] = useState(() => { try { return localStorage.getItem('race-wallet-last-import') || ''; } catch { return ''; } });
  const [status, setStatus] = useState<any>(null);
  const [statusError, setStatusError] = useState('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/races').then(jsonResponse).then(json => {
      if (!json.success) throw new Error(json.error || 'Could not load events');
      if (active) { setRaces(json.data); setRaceId(json.data[0]?.id || ''); }
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  const refreshStatus = async () => {
    if (!batchId) return;
    try {
      const result = await jsonResponse(await fetch(`/api/import/${batchId}/status`));
      if (!result.success) throw new Error(result.error || 'Could not load import progress');
      setStatus(result.data); setStatusError('');
    } catch (err: any) { setStatusError(err.message); }
  };
  const pending = !status || ['queued', 'processing', 'retrying'].some(key => (status.counts?.[key] || 0) > 0);
  useEffect(() => {
    if (!batchId) return;
    let active = true;
    const poll = async () => {
      try {
        const result = await jsonResponse(await fetch(`/api/import/${batchId}/status`));
        if (!result.success) throw new Error(result.error || 'Could not load import progress');
        if (active) { setStatus(result.data); setStatusError(''); }
      } catch (err: any) { if (active) setStatusError(err.message); }
    };
    poll();
    const timer = pending ? setInterval(poll, 5000) : undefined;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [batchId, pending]);

  const loadCsv = (text: string) => {
    setResponse(null); setError('');
    try { const parsed = parseAthleteCsv(text); setRows(parsed.rows); setIssues(parsed.errors); }
    catch (err: any) { setRows([]); setIssues([]); setError(err.message); }
  };
  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', SAMPLE_ATHLETES_CSV], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'athlete-import-sample.csv';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { setRows([]); setError('CSV is too large (maximum 1 MB)'); return; }
    try { loadCsv(await file.text()); } catch { setError('Could not read the CSV file. Please select it again.'); }
    event.target.value = '';
  };
  const importRows = async () => {
    if (!raceId || !rows.length || issues.length || uploading) return;
    setUploading(true); setError(''); setResponse(null);
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ race_id: raceId, rows, resume_pending: resumePending }) });
      const result = await jsonResponse(res);
      setResponse(result);
      if (result.data?.batch_id) {
        setStatus(null); setBatchId(result.data.batch_id);
        try { localStorage.setItem('race-wallet-last-import', result.data.batch_id); } catch {}
      }
      if (!res.ok || !result.success) setError(result.error || 'Import failed');
    } catch (err: any) { setError(err.message || 'Could not upload athletes'); }
    finally { setUploading(false); }
  };
  const retryFailed = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/import/${batchId}/retry`, { method: 'POST' });
      const result = await jsonResponse(res);
      if (!res.ok || !result.success) throw new Error(result.error || 'Retry failed');
      setStatus(null); await refreshStatus();
    } catch (err: any) { setStatusError(err.message); }
    finally { setRetrying(false); }
  };
  const reportIssues = [...(response?.data?.errors || []), ...(response?.data?.skipped || [])];
  const failedCount = (status?.counts?.failed || 0) + (status?.counts?.enqueue_failed || 0);

  return <div className="space-y-6">
    <div><h2 className="text-xl font-bold text-white">Bulk Athlete Import</h2>
      <p className="text-sm text-slate-400 mt-1">Upload your roster, review it, then import. Passes and email invitations are processed automatically.</p></div>
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
      <label className="block text-sm text-slate-300">Event
        <select value={raceId} onChange={event => setRaceId(event.target.value)} disabled={uploading}
          className="block w-full mt-2 bg-slate-950 border border-slate-700 rounded-xl p-3 text-white">
          {!races.length && <option value="">Create an event first</option>}
          {races.map(race => <option key={race.id} value={race.id}>{race.name}</option>)}
        </select>
      </label>
      <div className="flex gap-3 flex-wrap">
        <button type="button" onClick={downloadSample} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 text-slate-950 font-semibold text-sm"><Download size={16} />Download Sample CSV</button>
        <button type="button" onClick={() => loadCsv(SAMPLE_ATHLETES_CSV)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm"><FileText size={16} />Preview Sample</button>
      </div>
      <p className="text-xs text-slate-400">Required columns: <code>first_name, last_name, email</code>. Optional fields include bib_number, start_wave, race_division, corral_letter, target_pace, tshirt_size, and emergency_contact. Other columns are saved as participant data. Maximum {MAX_IMPORT_ROWS} athletes per file.</p>
      <p className="text-xs text-amber-300">Replace the sample's example.com addresses with your athletes' real email addresses before importing.</p>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={resumePending} onChange={event => setResumePending(event.target.checked)} disabled={uploading} />Retry pending athletes already saved in this event</label>
      <p className="text-xs text-slate-400">Use this to recover an earlier import that saved athletes without issuing passes. Issued athletes and imports still processing are skipped.</p>
      <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={uploading} aria-label="Upload athlete CSV" className="block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-950 file:px-3 file:py-2 file:text-sky-300" />
      {error && <div role="alert" className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-300 text-sm flex gap-2"><AlertTriangle size={18} className="shrink-0" />{error}</div>}
      {issues.length > 0 && <div role="alert" className="text-sm text-red-300"><p>Correct these rows before importing:</p><ul className="list-disc pl-5 mt-2">{issues.map((issue, index) => <li key={index}>Row {issue.row}: {issue.error}</li>)}</ul></div>}
      {rows.length > 0 && <>
        <h3 className="font-semibold text-white">Preview: {rows.length} athletes</h3>
        <div className="overflow-x-auto border border-slate-800 rounded-xl"><table className="w-full text-sm text-left"><thead className="bg-slate-950 text-slate-400"><tr><th className="p-3">Bib</th><th className="p-3">Athlete</th><th className="p-3">Email</th><th className="p-3">Wave</th></tr></thead><tbody className="text-slate-200">{rows.slice(0, 5).map((row, index) => <tr key={index} className="border-t border-slate-800"><td className="p-3">{row.bib_number || row.bib || '—'}</td><td className="p-3">{row.first_name} {row.last_name}</td><td className="p-3">{row.email}</td><td className="p-3">{row.start_wave || row.wave || '—'}</td></tr>)}</tbody></table></div>
        {rows.length > 5 && <p className="text-xs text-slate-400">And {rows.length - 5} more athletes.</p>}
        <button type="button" onClick={importRows} disabled={uploading || !raceId || !!issues.length} className="w-full flex justify-center items-center gap-2 py-3 rounded-xl bg-sky-500 text-slate-950 font-bold disabled:opacity-50"><Upload size={18} />{uploading ? 'Importing…' : `Import ${rows.length} Athletes`}</button>
      </>}
      {response?.data && <div role="status" className="p-4 rounded-xl bg-slate-950 text-slate-200 text-sm space-y-2">
        <p className="font-semibold">{response.message || 'Import result'}</p>
        <p>Queued: {response.data.total_enqueued || 0} · Skipped: {response.data.total_skipped || 0} · Invalid: {response.data.total_invalid || 0} · Resumed: {response.data.total_resumed || 0}</p>
        {reportIssues.length > 0 && <details><summary className="cursor-pointer text-amber-300">View skipped and invalid rows</summary><ul className="mt-2 space-y-1">{reportIssues.map((issue: ImportIssue, index: number) => <li key={index}>Row {issue.row} {issue.email}: {issue.error}</li>)}</ul></details>}
        <button type="button" onClick={() => onNavigateTab('races')} className="text-sky-400 underline">View athletes in event roster</button>
      </div>}
    </div>
    {batchId && <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-bold text-white">Import Progress</h3><button type="button" onClick={refreshStatus} aria-label="Refresh import progress" className="p-2 bg-slate-800 rounded-xl text-slate-300"><RefreshCw size={16} /></button></div>
      <p className="text-xs text-slate-400">Refreshes automatically while processing. Completed means the pass was issued and the email provider accepted the invitation.</p>
      {statusError && <p role="alert" className="text-red-300 text-sm">{statusError}</p>}
      {status && <>
        <div className="flex gap-4 flex-wrap text-sm text-slate-300"><span>Total: {status.total}</span><span className="text-emerald-300">Completed: {status.counts?.completed || 0}</span><span>Waiting: {status.counts?.queued || 0}</span><span>Processing: {status.counts?.processing || 0}</span><span className="text-amber-300">Retrying: {status.counts?.retrying || 0}</span><span className="text-red-300">Failed: {failedCount}</span></div>
        {(status.counts?.queued || 0) > 0 && <p className="text-xs text-slate-400">Small batches may take about 5 seconds to start. If they remain waiting, check that pass-issuance-queue has this Worker attached as its consumer.</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="py-2">Athlete</th><th className="py-2">Status</th><th className="py-2">Details</th></tr></thead><tbody>{status.rows?.map((job: any) => <tr key={job.id} className="border-t border-slate-800 text-slate-200"><td className="py-3 pr-4">{job.email}</td><td className="py-3 pr-4">{job.state === 'completed' ? <span className="flex gap-1 items-center text-emerald-300"><CheckCircle2 size={14} />Completed</span> : job.state.replace(/_/g, ' ')}</td><td className="py-3 text-xs text-amber-300">{job.last_error || (job.attempts ? `Attempts: ${job.attempts}` : '')}</td></tr>)}</tbody></table></div>
        {failedCount > 0 && <button type="button" onClick={retryFailed} disabled={retrying} className="px-4 py-2 bg-amber-400 text-slate-950 rounded-xl font-semibold text-sm disabled:opacity-50">{retrying ? 'Retrying…' : 'Retry Failed Athletes'}</button>}
      </>}
    </div>}
  </div>;
};
