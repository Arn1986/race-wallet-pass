import React, { useState, useEffect } from 'react';
import { Database, HardDrive, Terminal, Key, Play, Save, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink, Mail, Send, AlertTriangle, Info, Check, Copy } from 'lucide-react';

export const CloudflareConsoleTab: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'wrangler' | 'd1' | 'r2' | 'settings'>('wrangler');

  // D1 SQL Console State
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM Runners LIMIT 10;');
  const [sqlResults, setSqlResults] = useState<any[] | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // R2 Assets State
  const [assets, setAssets] = useState<any[]>([]);
  const [newAssetUrl, setNewAssetUrl] = useState('');
  const [newAssetFilename, setNewAssetFilename] = useState('');
  const [uploadingAsset, setUploadingAsset] = useState(false);

  // Settings State
  const [settings, setSettings] = useState({
    walletwalletApiKey: '',
    walletwalletApiUrl: 'https://api.walletwallet.dev',
    walletwalletPlan: 'free' as 'free' | 'pro',
    resendApiKey: '',
    emailFrom: '',
    publicDomain: '',
    hasResendKey: false,
    hasWalletWalletKey: false,
    configuredViaSecret: false,
    activeOrigin: '',
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Email Test State
  const [testEmailAddr, setTestEmailAddr] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<any | null>(null);

  // WalletWallet Status & Test State
  const [testingWalletWallet, setTestingWalletWallet] = useState(false);
  const [walletWalletResult, setWalletWalletResult] = useState<any | null>(null);

  useEffect(() => {
    fetchAssets();
    fetchSettings();
  }, []);

  const fetchAssets = async () => {
    try {
      const res = await fetch('/api/r2/assets');
      const json = await res.json();
      if (json.success) setAssets(json.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) setSettings(json.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunSql = async () => {
    if (!sqlQuery.trim()) return;
    try {
      setSqlRunning(true);
      setSqlError(null);
      const res = await fetch('/api/d1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sqlQuery }),
      });
      const json = await res.json();
      if (json.data?.error) {
        setSqlError(json.data.error);
        setSqlResults(null);
      } else {
        setSqlResults(json.data?.results || []);
      }
    } catch (err: any) {
      setSqlError(err.message || 'Error running query');
    } finally {
      setSqlRunning(false);
    }
  };

  const handleUploadR2Asset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssetFilename || !newAssetUrl) return;

    try {
      setUploadingAsset(true);
      const res = await fetch('/api/r2/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: newAssetFilename,
          url: newAssetUrl,
          size: 45200,
          mimeType: 'image/jpeg',
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNewAssetFilename('');
        setNewAssetUrl('');
        fetchAssets();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingAsset(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (json.success) {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
        fetchSettings();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailAddr.trim()) return;

    try {
      setTestingEmail(true);
      setTestEmailResult(null);
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmailAddr.trim() }),
      });
      const json = await res.json();
      setTestEmailResult(json);
    } catch (err: any) {
      setTestEmailResult({ success: false, error: err.message });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestWalletWallet = async () => {
    try {
      setTestingWalletWallet(true);
      setWalletWalletResult(null);
      const res = await fetch('/api/walletwallet/status');
      const json = await res.json();
      setWalletWalletResult(json);
    } catch (err: any) {
      setWalletWalletResult({ success: false, error: err.message });
    } finally {
      setTestingWalletWallet(false);
    }
  };

  const wranglerTomlContent = `name = "wallet-pass-platform"
main = "./node_modules/astro/dist/cloudflare/entrypoints/server.js"
compatibility_date = "2026-10-10"

# Cloudflare D1 Database
[[d1_databases]]
binding = "DB"
database_name = "wallet_pass_db"
database_id = "d1-f89a-412e-897b-walletpassdb01"

# Cloudflare R2 Bucket
[[r2_buckets]]
binding = "ASSETS_BUCKET"
bucket_name = "wallet-pass-assets"

# Cloudflare Queue (Producer / Consumer)
[[queues.producers]]
queue = "pass-issuance-queue"
binding = "PASS_QUEUE"

[[queues.consumers]]
queue = "pass-issuance-queue"
max_batch_size = 10
max_batch_timeout = 30

[vars]
PUBLIC_DOMAIN = "https://walletpass.cloud"
WALLETWALLET_API_URL = "https://api.walletwallet.dev"`;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Cloudflare Edge Architecture & Console</h2>
        <p className="text-xs text-slate-400">
          Inspect serverless D1 SQLite tables, R2 asset storage, Queue bindings, and API configuration.
        </p>
      </div>

      {/* Sub Navigation Bar */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveSubTab('wrangler')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
            activeSubTab === 'wrangler'
              ? 'bg-sky-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>wrangler.toml & Edge Bindings</span>
        </button>

        <button
          onClick={() => setActiveSubTab('d1')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
            activeSubTab === 'd1'
              ? 'bg-sky-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Cloudflare D1 SQL Console</span>
        </button>

        <button
          onClick={() => setActiveSubTab('r2')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
            activeSubTab === 'r2'
              ? 'bg-sky-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5" />
          <span>Cloudflare R2 Bucket Explorer</span>
        </button>

        <button
          onClick={() => setActiveSubTab('settings')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
            activeSubTab === 'settings'
              ? 'bg-sky-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>API Credentials & Keys</span>
        </button>
      </div>

      {/* SubTab 1: wrangler.toml */}
      {activeSubTab === 'wrangler' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-[10px] font-mono text-sky-400 uppercase font-bold">D1 Binding: `DB`</span>
              <h4 className="text-sm font-bold text-white mt-1">Cloudflare D1 Database</h4>
              <p className="text-xs text-slate-400 mt-1">
                Embedded SQLite database distributed across Cloudflare edge data centers. Stores Organizations, Templates, Races, Runners, and Passes.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">R2 Binding: `ASSETS_BUCKET`</span>
              <h4 className="text-sm font-bold text-white mt-1">Cloudflare R2 Storage</h4>
              <p className="text-xs text-slate-400 mt-1">
                Zero-egress object storage for Apple Wallet strip graphics, event logos, and medal badge media.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Queue: `PASS_QUEUE`</span>
              <h4 className="text-sm font-bold text-white mt-1">Cloudflare Queues Worker</h4>
              <p className="text-xs text-slate-400 mt-1">
                Async batch processor (batch size 10) for bulk CSV ingestion and Resend email delivery.
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <span className="text-xs font-mono font-bold text-slate-300">/wrangler.toml</span>
              <span className="text-[11px] text-emerald-400 font-mono">Cloudflare Pages/Workers Mode</span>
            </div>
            <pre className="font-mono text-xs text-sky-300 bg-slate-950 p-4 rounded-2xl overflow-x-auto border border-slate-800/80 leading-relaxed">
              {wranglerTomlContent}
            </pre>
          </div>
        </div>
      )}

      {/* SubTab 2: D1 SQL Console */}
      {activeSubTab === 'd1' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-sky-400" /> Interactive D1 SQL Console
              </span>
              <div className="flex items-center space-x-2">
                {['SELECT * FROM Runners;', 'SELECT * FROM Passes;', 'SELECT * FROM Races;'].map((sample) => (
                  <button
                    key={sample}
                    onClick={() => setSqlQuery(sample)}
                    className="text-[10px] font-mono text-slate-400 hover:text-sky-400 bg-slate-950 px-2 py-1 rounded border border-slate-800 cursor-pointer"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                rows={3}
                className="w-full p-3 font-mono text-xs rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-sky-300 outline-none"
              />
            </div>

            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-400">
                Executes directly against the D1 SQLite edge database layer.
              </span>
              <button
                onClick={handleRunSql}
                disabled={sqlRunning}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-md shadow-sky-500/20 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{sqlRunning ? 'Executing...' : 'Run Query'}</span>
              </button>
            </div>

            {sqlError && (
              <div className="p-3 bg-rose-950 border border-rose-800 text-rose-300 text-xs rounded-xl font-mono">
                {sqlError}
              </div>
            )}

            {sqlResults && (
              <div className="mt-4 border border-slate-800 rounded-xl overflow-x-auto bg-slate-950 max-h-80">
                {sqlResults.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500 text-center">0 rows returned.</p>
                ) : (
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900 border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                      <tr>
                        {Object.keys(sqlResults[0]).map((col) => (
                          <th key={col} className="p-2.5 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {sqlResults.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/60">
                          {Object.values(row).map((val: any, valIdx) => (
                            <td key={valIdx} className="p-2.5 whitespace-nowrap text-slate-300">
                              {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SubTab 3: R2 Asset Storage */}
      {activeSubTab === 'r2' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Cloudflare R2 Bucket: `wallet-pass-assets`</h3>
                <p className="text-xs text-slate-400">Media storage for Apple Wallet strip graphics & logos</p>
              </div>
              <button
                onClick={fetchAssets}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Assets Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div key={asset.key} className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="h-28 w-full rounded-xl overflow-hidden bg-slate-900 relative">
                    <img src={asset.url} alt={asset.filename} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white truncate">{asset.filename}</p>
                    <p className="text-[10px] font-mono text-slate-400">{asset.key}</p>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{(asset.size / 1024).toFixed(1)} KB</span>
                      <a
                        href={asset.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:underline flex items-center gap-0.5"
                      >
                        Open <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Upload New Asset Form */}
            <form onSubmit={handleUploadR2Asset} className="pt-4 border-t border-slate-800 space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Register New R2 Asset
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Filename (e.g. medal_finish_banner.jpg)"
                  value={newAssetFilename}
                  onChange={(e) => setNewAssetFilename(e.target.value)}
                  className="px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                />
                <input
                  type="text"
                  required
                  placeholder="Public Image URL"
                  value={newAssetUrl}
                  onChange={(e) => setNewAssetUrl(e.target.value)}
                  className="px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={uploadingAsset}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save to R2 Bucket</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SubTab 4: Settings & Credentials */}
      {activeSubTab === 'settings' && (
        <div className="space-y-6 max-w-3xl">
          {/* Resend Status Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mail className="w-4 h-4 text-sky-400" />
                  Transactional Email Delivery (Resend API)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Pass invitations and self-service lookups dispatch magic links to participants via Resend.
                </p>
              </div>
              {settings.hasResendKey ? (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Resend Key Active
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-950 text-amber-400 border border-amber-800 flex items-center gap-1.5 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  RESEND_API_KEY Missing
                </span>
              )}
            </div>

            {/* Crucial Resend Free Tier Delivery Notice */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Important Details for Receiving Emails with Resend:</span>
              </div>
              <ul className="text-slate-400 space-y-1.5 list-disc list-inside leading-relaxed text-[11.5px]">
                <li>
                  <strong className="text-slate-300">Free Testing Mode:</strong> If you are using Resend's default sender (<code className="text-sky-300 bg-slate-900 px-1 rounded">onboarding@resend.dev</code>), Resend only allows sending to the <em>single email address that you used to register your Resend account</em>.
                </li>
                <li>
                  <strong className="text-slate-300">Sending to Any Attendee:</strong> To send passes to arbitrary runner emails, add and verify your custom DNS domain (SPF & DKIM) at <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="text-sky-400 underline hover:text-sky-300">resend.com/domains</a>, then set <strong className="text-slate-300">EMAIL_FROM</strong> below (e.g. <code className="text-sky-300 bg-slate-900 px-1 rounded">Passes &lt;tickets@yourdomain.com&gt;</code>).
                </li>
                <li>
                  <strong className="text-slate-300">Direct Pass URLs:</strong> Even if emails fail or are pending domain verification, every registered participant can be viewed immediately via their direct link in the <span className="text-sky-300 font-semibold">Races & Participants</span> roster!
                </li>
              </ul>
            </div>

            {/* Test Email Dispatch Tool */}
            <div className="pt-2 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-sky-400" />
                Live Resend Delivery Smoke Test
              </h4>
              <form onSubmit={handleTestEmail} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  required
                  placeholder="Enter your email to receive a test pass..."
                  value={testEmailAddr}
                  onChange={(e) => setTestEmailAddr(e.target.value)}
                  className="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-white outline-none"
                />
                <button
                  type="submit"
                  disabled={testingEmail}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer shrink-0 shadow-md shadow-sky-500/20"
                >
                  {testingEmail ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Sending Test...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Test Pass Email</span>
                    </>
                  )}
                </button>
              </form>

              {testEmailResult && (
                <div
                  className={`mt-3 p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                    testEmailResult.success
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5">
                    {testEmailResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>{testEmailResult.message || (testEmailResult.success ? 'Email sent successfully!' : 'Email delivery failed')}</span>
                  </div>
                  {testEmailResult.data?.hint && (
                    <p className="text-[11px] text-amber-300/90 bg-amber-950/50 p-2 rounded-xl border border-amber-900/50">
                      💡 <strong>Notice:</strong> {testEmailResult.data.hint}
                    </p>
                  )}
                  {testEmailResult.data?.passUrl && (
                    <p className="text-[11px] text-slate-400">
                      Pass URL generated: <a href={testEmailResult.data.passUrl} target="_blank" rel="noreferrer" className="text-sky-400 underline">{testEmailResult.data.passUrl}</a>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Configuration Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-sky-400" />
                Environment & API Credentials
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Keys saved here are stored securely in Cloudflare D1 and override defaults without requiring a rebuild.
              </p>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1">
                  RESEND_API_KEY
                </label>
                <input
                  type="text"
                  value={settings.resendApiKey}
                  onChange={(e) => setSettings({ ...settings, resendApiKey: e.target.value })}
                  placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Get a free token from <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="text-sky-400 underline">resend.com/api-keys</a>.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block uppercase font-bold text-slate-400">
                    EMAIL_FROM (Sender Header)
                  </label>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, emailFrom: 'Pacific Athletic Series <passes@notification.3fstriders.org>' })}
                    className="text-[10px] text-sky-400 hover:text-sky-300 font-mono underline cursor-pointer"
                  >
                    Use verified domain (passes@notification.3fstriders.org)
                  </button>
                </div>
                <input
                  type="text"
                  value={settings.emailFrom || ''}
                  onChange={(e) => setSettings({ ...settings, emailFrom: e.target.value })}
                  placeholder="Pacific Athletic Series <passes@notification.3fstriders.org>"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
                />
                <div className="p-2.5 mt-2 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-[11px] text-emerald-300 space-y-1">
                  <p className="font-semibold text-emerald-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Verified Custom Domain: <code className="text-white font-mono bg-emerald-900/40 px-1 py-0.5 rounded">notification.3fstriders.org</code>
                  </p>
                  <p className="text-emerald-300/90 leading-relaxed">
                    With your verified domain, you can send pass delivery emails to <strong>any runner or tester email address</strong> (e.g., using <code className="text-white font-mono">passes@notification.3fstriders.org</code>). Click <strong>Save Configuration to D1</strong> below to persist.
                  </p>
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1">
                  PUBLIC_DOMAIN (Magic Pass Link Base URL)
                </label>
                <input
                  type="text"
                  value={settings.publicDomain}
                  readOnly
                  placeholder="https://walletpass.3fstriders.org"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Participant links use this public address. Change PUBLIC_DOMAIN in wrangler.toml to update it.
                </p>
              </div>

              {/* WalletWallet.dev Integration Section */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block uppercase font-bold text-slate-300">
                      WalletWallet.dev Integration & Plan Tier
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Unified Apple Wallet (.pkpass) and Google Wallet pass issuance per{' '}
                      <a href="https://www.walletwallet.dev/docs" target="_blank" rel="noreferrer" className="text-sky-400 underline">walletwallet.dev/docs</a>.
                    </p>
                  </div>
                  <a
                    href="https://www.walletwallet.dev/docs"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
                  >
                    <span>Official Docs</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Plan Tier Selection (Free vs Pro) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div
                    onClick={() => setSettings({ ...settings, walletwalletPlan: 'free' })}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                      settings.walletwalletPlan === 'free'
                        ? 'bg-sky-950/40 border-sky-500 text-white shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${settings.walletwalletPlan === 'free' ? 'bg-sky-400' : 'bg-slate-600'}`} />
                        Free Tier (Non-Pro Feature)
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold">
                        1,000 passes/mo
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Issues passes using standard <code className="text-sky-300">colorPreset</code> (dark, blue, green, red, purple, orange), QR codes, and all data fields without requiring a paid subscription or credit card.
                    </p>
                  </div>

                  <div
                    onClick={() => setSettings({ ...settings, walletwalletPlan: 'pro' })}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                      settings.walletwalletPlan === 'pro'
                        ? 'bg-sky-950/40 border-sky-500 text-white shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${settings.walletwalletPlan === 'pro' ? 'bg-sky-400' : 'bg-slate-600'}`} />
                        Pro Tier ($39/mo)
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950 text-purple-400 border border-purple-800 font-mono font-bold">
                        100,000 passes/mo
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Unlocks custom hex colors, hero strip images, lock screen geofences, and live APNs push notifications via <code className="text-purple-300">PUT /api/passes/:serial</code>.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">
                    WALLETWALLET_API_KEY
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={settings.walletwalletApiKey}
                      onChange={(e) => setSettings({ ...settings, walletwalletApiKey: e.target.value })}
                      placeholder="ww_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleTestWalletWallet}
                      disabled={testingWalletWallet}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs border border-slate-700 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {testingWalletWallet ? 'Testing...' : 'Verify Connection'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Bearer token from your WalletWallet dashboard (<code className="text-sky-300">ww_live_...</code>).
                  </p>
                </div>

                {walletWalletResult && (
                  <div
                    className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                      walletWalletResult.success
                        ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5">
                      {walletWalletResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                      )}
                      <span>{walletWalletResult.message || (walletWalletResult.success ? 'WalletWallet API Connected!' : 'Connection Failed')}</span>
                    </div>
                    {walletWalletResult.error && (
                      <p className="text-[11px] text-rose-300/90 font-mono">
                        {walletWalletResult.error}
                      </p>
                    )}
                    {walletWalletResult.usage && (
                      <div className="text-[11px] text-slate-300 font-mono bg-slate-950/60 p-2 rounded-xl">
                        Monthly passes count: {JSON.stringify(walletWalletResult.usage)}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">
                    WALLETWALLET_API_URL
                  </label>
                  <input
                    type="text"
                    value={settings.walletwalletApiUrl}
                    onChange={(e) => setSettings({ ...settings, walletwalletApiUrl: e.target.value })}
                    placeholder="https://api.walletwallet.dev"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Official Base URL per docs is <code className="text-sky-300">https://api.walletwallet.dev</code>.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                {settingsSaved ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Configuration saved to Cloudflare D1!
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-md shadow-sky-500/20"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Configuration to D1</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
