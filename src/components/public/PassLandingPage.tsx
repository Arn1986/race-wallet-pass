import React, { useState, useEffect } from 'react';
import { AppleWalletPassCard } from './AppleWalletPassCard.tsx';
import { GoogleWalletPassCard } from './GoogleWalletPassCard.tsx';
import { Runner, Race, PassTemplate, Pass } from '../../types/index.ts';
import { Download, Share2, ArrowLeft, Check, BellRing, Sparkles, RefreshCw, AlertCircle, Smartphone, ExternalLink } from 'lucide-react';

interface PassLandingPageProps {
  runnerId: string;
  onNavigateHome?: () => void;
  onNavigateLookup?: () => void;
}

export const PassLandingPage: React.FC<PassLandingPageProps> = ({
  runnerId,
  onNavigateHome,
  onNavigateLookup,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    runner: Runner;
    race: Race;
    template: PassTemplate;
    pass: Pass;
  } | null>(null);

  const [activePlatform, setActivePlatform] = useState<'apple' | 'google'>('apple');
  const [isFlipped, setIsFlipped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [syncingPass, setSyncingPass] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  // Live Push Notification Simulation
  const [pushNotification, setPushNotification] = useState<{
    title: string;
    message: string;
    time: string;
  } | null>(null);
  const [simulatingUpdate, setSimulatingUpdate] = useState(false);

  const fetchPassDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/pass/details/${runnerId}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Pass details not found');
      }
      setData(json.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load digital pass');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPassDetails();
  }, [runnerId]);

  const handleDownloadApplePass = async () => {
    if (!data) return;
    try {
      setDownloading(true);
      // If pass has not been provisioned with WalletWallet yet, attempt a live sync
      if (!data.pass?.apple_pass_base64) {
        try {
          const syncRes = await fetch(`/api/pass/sync/${runnerId}`, { method: 'POST' });
          const syncJson = await syncRes.json();
          if (syncJson.success) {
            await fetchPassDetails();
          }
        } catch {}
      }

      // Direct stream download of .pkpass
      const downloadUrl = `/api/pass/download/${runnerId}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `pass_${runnerId}.pkpass`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Re-fetch to reflect installed_apple = 1
      setTimeout(() => {
        fetchPassDetails();
        setDownloading(false);
      }, 1000);
    } catch (err) {
      setDownloading(false);
    }
  };

  const handleAddGoogleWallet = async () => {
    if (!data) return;
    try {
      await fetch(`/api/pass/mark-google/${runnerId}`, { method: 'POST' });
      if (data.pass?.google_save_url) {
        window.open(data.pass.google_save_url, '_blank');
        return;
      }

      // If google_save_url was not generated yet, perform live sync with WalletWallet
      setSyncingPass(true);
      const syncRes = await fetch(`/api/pass/sync/${runnerId}`, { method: 'POST' });
      const syncJson = await syncRes.json();
      if (syncJson.success && syncJson.googleSaveUrl) {
        await fetchPassDetails();
        window.open(syncJson.googleSaveUrl, '_blank');
      } else {
        const errorMsg = syncJson.error || 'WALLETWALLET_API_KEY is not configured yet.';
        setWalletNotice(errorMsg);
      }
    } catch (err: any) {
      setWalletNotice(err.message || 'Error connecting to Wallet API');
    } finally {
      setSyncingPass(false);
    }
  };

  const handleSimulateOrganizerUpdate = async (type: 'wave' | 'corral' | 'weather') => {
    if (!data || simulatingUpdate) return;
    try {
      setSimulatingUpdate(true);
      let dyn: Record<string, any> = {};
      try {
        dyn = JSON.parse(data.runner.dynamic_data || '{}');
      } catch {
        dyn = {};
      }

      let fieldName = '';
      let oldValue = '';
      let newValue = '';
      let notifMessage = '';

      if (type === 'wave') {
        fieldName = 'start_wave';
        oldValue = dyn.start_wave || 'Wave A (06:30 AM)';
        newValue = dyn.start_wave?.includes('06:45') ? 'Wave A (06:30 AM)' : 'Wave A (Delayed: 06:45 AM)';
        dyn.start_wave = newValue;
        notifMessage = `Start Wave timing updated to: ${newValue}`;
      } else if (type === 'corral') {
        fieldName = 'corral_letter';
        oldValue = dyn.corral_letter || 'Chute Red 1';
        newValue = dyn.corral_letter === 'Chute Gold Priority' ? 'Chute Red 1' : 'Chute Gold Priority (VIP Chute)';
        dyn.corral_letter = newValue;
        notifMessage = `Corral assignment upgraded to: ${newValue}`;
      } else {
        fieldName = 'race_rules';
        oldValue = dyn.race_rules || 'Standard rules';
        newValue = 'HEAT PROTOCOL ACTIVATED: Additional hydration at Miles 5, 11, 17, and 23.';
        dyn.race_rules = newValue;
        notifMessage = 'RACE ADVISORY: Heat hydration protocol activated.';
      }

      const res = await fetch('/api/runner/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runner_id: runnerId,
          dynamic_data: dyn,
          field_changed: fieldName,
          old_value: oldValue,
          new_value: newValue,
        }),
      });

      const json = await res.json();
      if (json.success) {
        // Trigger simulated lock screen banner
        setPushNotification({
          title: `Wallet • ${data.race.name.substring(0, 24)}...`,
          message: notifMessage,
          time: 'Now',
        });
        await fetchPassDetails();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSimulatingUpdate(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
        <div className="w-12 h-12 border-4 border-sky-500/30 border-t-sky-400 rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400 animate-pulse font-medium">Retrieving verified pass from edge proxy...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-xl">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold mb-2">Pass Not Found</h2>
          <p className="text-sm text-slate-400 mb-6">{error || 'This participant record does not exist or has been removed.'}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {onNavigateLookup && (
              <button
                onClick={onNavigateLookup}
                className="px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl font-semibold text-sm transition-all"
              >
                Self-Service Lookup
              </button>
            )}
            {onNavigateHome && (
              <button
                onClick={onNavigateHome}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-sm transition-all"
              >
                Return to Dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { runner, race, template, pass } = data;
  const isRevoked = pass.status === 'revoked';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white pb-16">
      {/* Top Simulated iOS Push Notification Banner */}
      {pushNotification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md animate-bounce">
          <div className="bg-slate-900/95 border border-sky-500/40 backdrop-blur-xl shadow-2xl rounded-2xl p-3.5 flex items-start space-x-3 text-white">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-md">
              <BellRing className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wide">
                  {pushNotification.title}
                </span>
                <span className="text-[10px] text-slate-400">{pushNotification.time}</span>
              </div>
              <p className="text-xs font-semibold text-white/95 mt-0.5 leading-snug">
                {pushNotification.message}
              </p>
            </div>
            <button
              onClick={() => setPushNotification(null)}
              className="text-slate-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {onNavigateHome && (
              <button
                onClick={onNavigateHome}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all mr-1"
                title="Organizer Portal"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider">
              Cloudflare Edge Pass Gateway
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyLink}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied Link' : 'Share'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-3xl mx-auto px-4 pt-6">
        {/* Event Header Banner */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-[11px] font-semibold text-slate-300 mb-2">
            <span>{race.location}</span>
            <span>•</span>
            <span>
              {new Date(race.event_date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {race.name}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Participant Digital Badge for{' '}
            <span className="text-white font-semibold">
              {runner.first_name} {runner.last_name}
            </span>
          </p>
        </div>

        {/* Platform View Selector Tabs */}
        <div className="flex justify-center mb-6">
          <div className="bg-slate-900 border border-slate-800 p-1 rounded-xl flex items-center space-x-1 shadow-lg">
            <button
              onClick={() => setActivePlatform('apple')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 ${
                activePlatform === 'apple'
                  ? 'bg-slate-800 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Apple Wallet</span>
            </button>
            <button
              onClick={() => setActivePlatform('google')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 ${
                activePlatform === 'google'
                  ? 'bg-slate-800 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
              <span>Google Wallet</span>
            </button>
          </div>
        </div>

        {/* Pass Visual Card */}
        <div className="mb-6">
          {activePlatform === 'apple' ? (
            <AppleWalletPassCard
              runner={runner}
              race={race}
              template={template}
              pass={pass}
              isFlipped={isFlipped}
              onFlip={() => setIsFlipped(!isFlipped)}
            />
          ) : (
            <GoogleWalletPassCard
              runner={runner}
              race={race}
              template={template}
              pass={pass}
            />
          )}

          {activePlatform === 'apple' && (
            <div className="text-center mt-3">
              <button
                onClick={() => setIsFlipped(!isFlipped)}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>{isFlipped ? 'Flip to Pass Front' : 'Flip to View Emergency Contact & Back Details'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Official "Add to Wallet" Action Buttons */}
        <div className="max-w-sm mx-auto space-y-3 mb-8">
          {/* Apple Wallet Official Button */}
          <button
            onClick={handleDownloadApplePass}
            disabled={downloading || isRevoked}
            className={`w-full py-3.5 px-4 rounded-2xl bg-black hover:bg-neutral-900 border border-neutral-700 active:scale-[0.98] transition-all flex items-center justify-center space-x-3 shadow-xl cursor-pointer ${
              isRevoked ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {/* Apple Logo SVG */}
            <svg viewBox="0 0 170 170" className="w-5 h-5 fill-current text-white">
              <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.74 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.66-7.86-11.91-14.46-5.74-9.01-10.23-19.34-13.48-30.98-3.26-11.64-4.89-22.95-4.89-33.93 0-16.14 4.35-29.49 13.04-40.06 8.69-10.58 19.53-15.98 32.51-16.23 4.93 0 10.42 1.34 16.47 4.02 6.05 2.68 9.97 4.09 11.75 4.22 1.57-.13 5.74-1.61 12.51-4.43 6.77-2.82 12.44-4.08 17.02-3.79 12.73.65 23.01 5.34 30.82 14.07-11.22 6.74-16.71 16.4-16.47 28.98.24 9.94 4.09 18.23 11.55 24.87 7.46 6.64 16.46 10.32 27.01 11.03-2.24 6.84-4.99 14.08-8.26 21.72zM119.22 31.84c0-7.39 2.65-14.28 7.95-20.67 5.3-6.39 11.95-10.45 19.95-12.17.65 1.52.98 3.14.98 4.86 0 7.39-2.73 14.41-8.19 21.06-5.46 6.65-12.16 10.6-20.09 11.85-.43-1.63-.6-3.27-.6-4.93z" />
            </svg>
            <div className="text-left">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold leading-tight">
                {downloading ? 'Streaming .pkpass...' : 'Add to'}
              </p>
              <p className="text-sm font-bold text-white leading-tight">Apple Wallet</p>
            </div>
            <Download className="w-4 h-4 text-neutral-400 ml-auto" />
          </button>

          {/* Google Wallet Official Button */}
          <button
            onClick={handleAddGoogleWallet}
            disabled={isRevoked || syncingPass}
            className={`w-full py-3.5 px-4 rounded-2xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 active:scale-[0.98] transition-all flex items-center justify-center space-x-3 shadow-xl cursor-pointer ${
              isRevoked ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
            </svg>
            <div className="text-left">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold leading-tight">
                {syncingPass ? 'Generating Google Pass...' : 'Save to'}
              </p>
              <p className="text-sm font-bold text-white leading-tight">Google Wallet</p>
            </div>
            <Sparkles className="w-4 h-4 text-sky-400 ml-auto" />
          </button>

          {/* Wallet Notice Card */}
          {walletNotice && (
            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200 space-y-1.5 text-left">
              <div className="font-bold flex items-center justify-between text-amber-300">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-400" /> Wallet API Key Notice
                </span>
                <button
                  onClick={() => setWalletNotice(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                {walletNotice}
              </p>
              <p className="text-[10.5px] text-slate-400">
                To issue real signed Apple & Google passes, obtain a free API key at <a href="https://www.walletwallet.dev" target="_blank" rel="noreferrer" className="text-sky-400 underline">walletwallet.dev</a> (up to 1,000 passes/mo) and add it under Admin Settings or wrangler.toml.
              </p>
              {onNavigateHome && (
                <div className="pt-1">
                  <button
                    onClick={onNavigateHome}
                    className="text-[11px] font-bold text-sky-400 hover:text-sky-300 underline cursor-pointer"
                  >
                    Go to Admin Console & Settings →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* WalletWallet Hosted Device-Aware Share Link */}
          {data.pass?.share_url && (
            <a
              href={data.pass.share_url}
              target="_blank"
              rel="noreferrer"
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-sky-400 hover:text-sky-300 text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer text-center"
            >
              <span>Open Device-Aware Install Page (WalletWallet)</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Live APNs / Push Notification Test Console (For Organizers and Runners) */}
        <div className="max-w-md mx-auto bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <BellRing className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Live Silent Push Simulator (APNs / FCM)
              </h3>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800 font-mono">
              Live Proxy
            </span>
          </div>

          <p className="text-xs text-slate-400 mb-3 leading-relaxed">
            Test silent edge updates. When race directors change wave times or gates, Apple Wallet quietly updates the lock screen without re-downloading!
          </p>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleSimulateOrganizerUpdate('wave')}
              disabled={simulatingUpdate || isRevoked}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold border border-slate-700/60 transition-all flex flex-col items-center text-center cursor-pointer disabled:opacity-50"
            >
              <span>⏱️ Wave Delay</span>
              <span className="text-[10px] text-slate-400 font-normal mt-0.5">+15 Mins</span>
            </button>
            <button
              onClick={() => handleSimulateOrganizerUpdate('corral')}
              disabled={simulatingUpdate || isRevoked}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold border border-slate-700/60 transition-all flex flex-col items-center text-center cursor-pointer disabled:opacity-50"
            >
              <span>🚪 Corral Gate</span>
              <span className="text-[10px] text-slate-400 font-normal mt-0.5">VIP Priority</span>
            </button>
            <button
              onClick={() => handleSimulateOrganizerUpdate('weather')}
              disabled={simulatingUpdate || isRevoked}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold border border-slate-700/60 transition-all flex flex-col items-center text-center cursor-pointer disabled:opacity-50"
            >
              <span>☀️ Weather</span>
              <span className="text-[10px] text-slate-400 font-normal mt-0.5">Heat Alert</span>
            </button>
          </div>
        </div>

        {/* Self-service Lookup link for lost passes */}
        <div className="text-center mt-8">
          <p className="text-xs text-slate-500">
            Lost your pass link? Use our{' '}
            <button
              onClick={onNavigateLookup}
              className="text-sky-400 hover:underline cursor-pointer"
            >
              Self-Service Lookup Portal
            </button>{' '}
            to re-send your verified badge.
          </p>
        </div>
      </main>
    </div>
  );
};
