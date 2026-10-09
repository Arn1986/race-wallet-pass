import React, { useState, useEffect } from 'react';
import { Database, HardDrive, Terminal, Key, Play, Save, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink } from 'lucide-react';

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
    walletwalletApiUrl: '',
    resendApiKey: '',
    publicDomain: '',
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

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
      }
    } catch (err) {
      console.error(err);
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
WALLETWALLET_API_URL = "https://api.walletwallet.dev/v1"`;

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
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl max-w-2xl space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white">API Credentials & Cloudflare Environment</h3>
            <p className="text-xs text-slate-400">
              Configure credentials for walletwallet.dev, Resend transactional emails, and custom domain routing.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            <div>
              <label className="block uppercase font-bold text-slate-400 mb-1">
                WALLETWALLET_API_KEY
              </label>
              <input
                type="text"
                value={settings.walletwalletApiKey}
                onChange={(e) => setSettings({ ...settings, walletwalletApiKey: e.target.value })}
                placeholder="ww_live_sk_..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Connects to walletwallet.dev for production APNs and FCM certificate signing and push dispatch.
              </p>
            </div>

            <div>
              <label className="block uppercase font-bold text-slate-400 mb-1">
                WALLETWALLET_API_URL
              </label>
              <input
                type="text"
                value={settings.walletwalletApiUrl}
                onChange={(e) => setSettings({ ...settings, walletwalletApiUrl: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
              />
            </div>

            <div>
              <label className="block uppercase font-bold text-slate-400 mb-1">
                RESEND_API_KEY
              </label>
              <input
                type="text"
                value={settings.resendApiKey}
                onChange={(e) => setSettings({ ...settings, resendApiKey: e.target.value })}
                placeholder="re_..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Transactional email delivery of magic pass links.
              </p>
            </div>

            <div>
              <label className="block uppercase font-bold text-slate-400 mb-1">
                PUBLIC_DOMAIN
              </label>
              <input
                type="text"
                value={settings.publicDomain}
                onChange={(e) => setSettings({ ...settings, publicDomain: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 font-mono text-white outline-none"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              {settingsSaved ? (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Configuration updated!
                </span>
              ) : (
                <span />
              )}
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-md shadow-sky-500/20"
              >
                <Save className="w-4 h-4" />
                <span>Save Credentials</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
