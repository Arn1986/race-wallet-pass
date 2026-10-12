import React, { useState, useEffect } from 'react';
import { Race } from '../../types/index.ts';
import { Search, Mail, ArrowRight, CheckCircle2, AlertCircle, ArrowLeft, ShieldCheck } from 'lucide-react';

interface LookupPageProps {
  onNavigatePass: (runnerId: string) => void;
  onNavigateHome: () => void;
}

export const LookupPage: React.FC<LookupPageProps> = ({ onNavigatePass, onNavigateHome }) => {
  const [email, setEmail] = useState('');
  const [raceId, setRaceId] = useState('');
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    runner_id: string;
    email: string;
    pass_url: string;
    race_name?: string;
    email_log?: any;
  } | null>(null);

  useEffect(() => {
    fetch('/api/races')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setRaces(json.data);
      })
      .catch(() => {});
  }, []);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    try {
      setLoading(true);
      setError(null);
      setResult(null);

      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), race_id: raceId || undefined }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'No registration found for that email address.');
      }

      setResult(json.data);
    } catch (err: any) {
      setError(err.message || 'Lookup failed. Please check the email entered.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <button
          onClick={onNavigateHome}
          className="flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Organizer Dashboard</span>
        </button>

        <div className="flex items-center space-x-2 text-xs text-slate-400 font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Resend Gateway Integrated</span>
        </div>
      </header>

      {/* Main lookup container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mb-5">
            <Mail className="w-6 h-6" />
          </div>

          <h2 className="text-2xl font-black tracking-tight text-white mb-2">
            Find & Re-deliver Your Pass
          </h2>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Enter the email address you registered with to look up your digital bib pass and receive a secure instant re-delivery link.
          </p>

          <form onSubmit={handleLookup} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Registration Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="runner@example.com (e.g. arnoldcaisip@gmail.com)"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-white text-sm outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Event / Race (Optional)
              </label>
              <select
                value={raceId}
                onChange={(e) => setRaceId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-sm outline-none transition-all"
              >
                <option value="">Any Registered Event</option>
                {races.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start space-x-2 text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.99] text-slate-950 font-bold text-sm flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Searching D1 Database...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Lookup Digital Pass</span>
                </>
              )}
            </button>
          </form>

          {/* Result Card */}
          {result && (
            <div className="mt-6 pt-6 border-t border-slate-800 animate-fadeIn">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 mb-4">
                <div className="flex items-center space-x-2 font-bold text-sm mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Registration Found!</span>
                </div>
                <p className="text-xs opacity-90">
                  A fresh pass magic link has been dispatched via Resend to{' '}
                  <strong className="text-white">{result.email}</strong>.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Event</p>
                  <p className="text-sm font-bold text-white truncate max-w-[200px]">
                    {result.race_name || 'Golden Gate Marathon 2026'}
                  </p>
                </div>
                <p className="text-xs text-slate-400">Open the personal link in your email.</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
