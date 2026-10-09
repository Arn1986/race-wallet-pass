import React, { useState, useEffect } from 'react';
import { Race } from '../../types/index.ts';
import { Upload, FileText, CheckCircle2, Clock, Play, ArrowRight, RefreshCw, AlertTriangle, Sparkles } from 'lucide-react';

interface CsvUploaderTabProps {
  onOpenRunnerPass: (runnerId: string) => void;
  onNavigateTab: (tab: string) => void;
}

export const CsvUploaderTab: React.FC<CsvUploaderTabProps> = ({
  onOpenRunnerPass,
  onNavigateTab,
}) => {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<string>('');
  const [csvContent, setCsvContent] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importResponse, setImportResponse] = useState<any | null>(null);

  // Queue Consumer Simulator State
  const [queueStatus, setQueueStatus] = useState<any | null>(null);
  const [workerRunning, setWorkerRunning] = useState(false);

  useEffect(() => {
    fetch('/api/races')
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data.length > 0) {
          setRaces(json.data);
          setSelectedRaceId(json.data[0].id);
        }
      });
    fetchQueueStatus();
  }, []);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch('/api/queue/status');
      const json = await res.json();
      if (json.success) {
        setQueueStatus(json.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sampleCsvData = `bib_number,first_name,last_name,email,start_wave,race_division,corral_letter,target_pace,tshirt_size,emergency_contact
6012,Mateo,Silva,mateo.silva@sample-race.com,Wave A (06:30 AM),Full Marathon (42.2K),Chute Red 1,4:10 min/km,Men M,Rosa Silva (+1 415-555-8821)
6013,Chloe,Dupont,chloe.dupont@sample-race.com,Wave A (06:30 AM),Full Marathon (42.2K),Chute Red 2,4:25 min/km,Women S,Pierre Dupont (+1 415-555-8822)
6014,Liam,Kowalski,liam.k@sample-race.com,Wave B (07:00 AM),Half Marathon (21.1K),Chute Yellow,4:50 min/km,Men L,Anna Kowalski (+1 510-555-8823)
6015,Aisha,Patel,aisha.patel@sample-race.com,Wave B (07:00 AM),Half Marathon (21.1K),Chute Yellow,5:05 min/km,Women M,Dev Patel (+1 408-555-8824)
6016,Hana,Tanaka,hana.tanaka@sample-race.com,Wave A (06:30 AM),Full Marathon (42.2K),Chute Red 1,3:58 min/km,Women XS,Kenji Tanaka (+1 650-555-8825)
6017,Jonas,Lindqvist,jonas.l@sample-race.com,Wave B (07:00 AM),Full Marathon (42.2K),Chute Yellow,4:40 min/km,Men XL,Astrid Lindqvist (+1 415-555-8826)
6018,Zoe,Washington,zoe.w@sample-race.com,Wave C (07:30 AM),10K Express,Chute Green,5:30 min/km,Women L,Marcus Washington (+1 925-555-8827)
6019,Tariq,Mansoor,tariq.m@sample-race.com,Wave A (06:30 AM),Full Marathon (42.2K),Chute Red 2,4:15 min/km,Men M,Layla Mansoor (+1 415-555-8828)`;

  const parseCsv = (text: string) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(',').map((v) => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });
      rows.push(row);
    }
    return rows;
  };

  const handleLoadSample = () => {
    setCsvContent(sampleCsvData);
    setParsedRows(parseCsv(sampleCsvData));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text);
      setParsedRows(parseCsv(text));
    };
    reader.readAsText(file);
  };

  const handleUploadToQueue = async () => {
    if (!selectedRaceId || parsedRows.length === 0) return;

    try {
      setUploading(true);
      setImportResponse(null);

      // Core Architecture Rule: POST /api/import writes D1 pending rows and returns 202 Accepted!
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          race_id: selectedRaceId,
          rows: parsedRows,
        }),
      });

      const json = await res.json();
      setImportResponse(json);
      await fetchQueueStatus();
    } catch (err: any) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleProcessQueueBatch = async () => {
    try {
      setWorkerRunning(true);
      const res = await fetch('/api/queue/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: 10 }),
      });
      const json = await res.json();
      await fetchQueueStatus();
    } catch (err) {
      console.error(err);
    } finally {
      setWorkerRunning(false);
    }
  };

  const queuedCount = queueStatus?.stats?.queued || 0;
  const completedCount = queueStatus?.stats?.completed || 0;
  const totalCount = queueStatus?.stats?.total || 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Bulk Participant CSV Importer</h2>
        <p className="text-xs text-slate-400">
          Non-blocking asynchronous ingestion using Cloudflare Queues (`PASS_QUEUE`) and D1 database.
        </p>
      </div>

      {/* Cloudflare Queue Architectural Callout */}
      <div className="p-4 rounded-2xl bg-sky-950/30 border border-sky-800/40 flex items-start space-x-3 text-xs text-sky-200">
        <Sparkles className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-sky-300">Cloudflare Async Execution Protocol (202 Accepted):</p>
          <p className="text-slate-300 leading-relaxed">
            Large athletic rosters are never processed in synchronous HTTP loops. Ingestion writes raw rows into D1 with status <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300 font-mono text-[10px]">pending</code>, enqueues to Cloudflare <code className="bg-slate-900 px-1 py-0.5 rounded text-sky-300 font-mono text-[10px]">PASS_QUEUE</code>, and returns a <code className="bg-slate-900 px-1 py-0.5 rounded text-emerald-300 font-mono text-[10px]">202 Accepted</code>. The background queue consumer issues passes in batches and sends Resend emails.
          </p>
        </div>
      </div>

      {/* Ingestion Configuration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase font-bold text-slate-400 mb-1.5">
              1. Target Race / Event
            </label>
            <select
              value={selectedRaceId}
              onChange={(e) => setSelectedRaceId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
            >
              {races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.location})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end space-x-2">
            <button
              onClick={handleLoadSample}
              type="button"
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 flex items-center space-x-2 cursor-pointer transition-all"
            >
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span>Load Sample Marathon Roster (8 Runners)</span>
            </button>
          </div>
        </div>

        {/* Drag and Drop Box */}
        <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-2xl p-6 text-center bg-slate-950/50">
          <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-300">
            Upload participant CSV file
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Columns supported: bib_number, first_name, last_name, email, start_wave, race_division, corral_letter, target_pace
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="mt-3 text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-sky-500/10 file:text-sky-400 hover:file:bg-sky-500/20 cursor-pointer"
          />
        </div>

        {/* Parsed Rows Preview */}
        {parsedRows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Preview: {parsedRows.length} Participants Ready to Enqueue
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Batch Size: 10 per worker chunk
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs bg-slate-950">
                <thead className="bg-slate-900 border-b border-slate-800 text-[10px] text-slate-400 uppercase font-mono">
                  <tr>
                    <th className="p-2.5">Bib</th>
                    <th className="p-2.5">Name</th>
                    <th className="p-2.5">Email</th>
                    <th className="p-2.5">Division</th>
                    <th className="p-2.5">Wave</th>
                    <th className="p-2.5">Corral</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {parsedRows.slice(0, 5).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/50">
                      <td className="p-2.5 font-mono text-sky-400 font-bold">{row.bib_number || '-'}</td>
                      <td className="p-2.5 text-white">{row.first_name} {row.last_name}</td>
                      <td className="p-2.5 text-slate-400">{row.email}</td>
                      <td className="p-2.5 text-slate-300">{row.race_division}</td>
                      <td className="p-2.5 text-slate-300">{row.start_wave}</td>
                      <td className="p-2.5 text-slate-300">{row.corral_letter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parsedRows.length > 5 && (
              <p className="text-[11px] text-slate-500 text-center">
                + {parsedRows.length - 5} more participants in CSV payload
              </p>
            )}

            <button
              onClick={handleUploadToQueue}
              disabled={uploading}
              className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              {uploading ? (
                <span>Writing to D1 and Enqueueing to PASS_QUEUE...</span>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Enqueue All {parsedRows.length} Participants to Cloudflare PASS_QUEUE (202 Accepted)</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* 202 Accepted Response Callout */}
        {importResponse && (
          <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs space-y-2 animate-fadeIn">
            <div className="flex items-center space-x-2 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>HTTP 202 ACCEPTED — Ingestion Succeeded</span>
            </div>
            <p className="opacity-90">{importResponse.message}</p>
            <div className="flex items-center gap-4 text-[11px] font-mono text-emerald-400">
              <span>Total Enqueued: {importResponse.data?.total_enqueued}</span>
              <span>Binding: {importResponse.data?.queue_binding}</span>
              <span>Batch Max: {importResponse.data?.batch_size}</span>
            </div>
          </div>
        )}
      </div>

      {/* Cloudflare Queue Consumer Dashboard */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Cloudflare Queue Consumer Monitor</h3>
              <p className="text-[11px] text-slate-400">Worker batch size: 10 • Max timeout: 30s</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchQueueStatus}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="Refresh queue metrics"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleProcessQueueBatch}
              disabled={workerRunning || queuedCount === 0}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-md shadow-emerald-500/20"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{workerRunning ? 'Worker Processing...' : `Execute Worker Batch (${queuedCount} Queued)`}</span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-400 font-mono">
            <span>Queue Backlog: {queuedCount} jobs</span>
            <span>Completed: {completedCount} passes</span>
          </div>
          <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
            <div
              className="bg-emerald-400 h-full rounded-full transition-all duration-500"
              style={{
                width: `${totalCount ? (completedCount / totalCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {/* Recent Jobs in Queue */}
        <div className="pt-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            Recent Worker Events
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {(queueStatus?.recent_jobs || []).length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No queue activity recorded.</p>
            ) : (
              (queueStatus?.recent_jobs || []).map((job: any) => (
                <div
                  key={job.id}
                  className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        job.status === 'completed'
                          ? 'bg-emerald-400'
                          : job.status === 'queued'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <span className="font-semibold text-white truncate">
                      {job.payload?.first_name} {job.payload?.last_name}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">({job.payload?.email})</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono uppercase text-slate-400">{job.status}</span>
                    {job.status === 'completed' && (
                      <button
                        onClick={() => onOpenRunnerPass(job.runner_id)}
                        className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                      >
                        Pass
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
