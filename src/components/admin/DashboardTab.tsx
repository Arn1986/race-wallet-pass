import React from 'react';
import { Smartphone, CheckCircle, Clock, Ban, Radio, Mail, ArrowUpRight, Flame } from 'lucide-react';

interface DashboardTabProps {
  stats: any;
  onNavigateTab: (tab: string) => void;
  onOpenRunnerPass: (runnerId: string) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  stats,
  onNavigateTab,
  onOpenRunnerPass,
}) => {
  const metrics = stats?.metrics || {
    totalPasses: 0,
    issuedPasses: 0,
    pendingPasses: 0,
    revokedPasses: 0,
    appleInstalls: 0,
    googleInstalls: 0,
    activeRaces: 0,
    templatesCount: 0,
  };

  const recentPushes = stats?.recent_pushes || [];
  const recentEmails = stats?.recent_emails || [];

  return (
    <div className="space-y-6">
      {/* Top Banner / Edge Architecture Badge */}
      <div className="bg-gradient-to-r from-slate-900 via-sky-950/40 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="relative z-10 max-w-xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Cloudflare Edge D1 • R2 • Queues • walletwallet.dev</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Multi-Tenant Wallet Pass Engine
          </h2>
          <p className="text-sm text-slate-300 mt-2 leading-relaxed">
            Zero-friction pass generation for mass-participation athletic events and endurance races.
            Silent APNs/FCM lockscreen push updates, .pkpass binary streaming proxy, and async queue imports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 relative z-10">
          <button
            onClick={() => onNavigateTab('import')}
            className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20"
          >
            <span>Bulk CSV Import</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => onNavigateTab('cloudflare')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-all cursor-pointer"
          >
            Inspect Edge Bindings
          </button>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-sky-500/10 to-transparent pointer-events-none" />
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Passes Issued */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Issued</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-white">{metrics.issuedPasses}</span>
            <span className="text-xs text-slate-400 font-medium">of {metrics.totalPasses} total</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-400 h-full rounded-full transition-all duration-500"
              style={{
                width: `${metrics.totalPasses ? (metrics.issuedPasses / metrics.totalPasses) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {/* Apple Wallet Installs */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Apple Wallet</span>
            <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-white">{metrics.appleInstalls}</span>
            <span className="text-xs text-sky-400 font-medium">PKPass downloads</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Direct .pkpass edge stream proxy</p>
        </div>

        {/* Google Wallet Installs */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Google Wallet</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-white">{metrics.googleInstalls}</span>
            <span className="text-xs text-blue-400 font-medium">Google Pay passes</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Saved to Google Pay accounts</p>
        </div>

        {/* Queued / Pending & Revoked */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Queue & Status</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-3">
            <div>
              <span className="text-2xl font-black text-amber-400">{metrics.pendingPasses}</span>
              <span className="text-[10px] text-slate-400 ml-1">Pending</span>
            </div>
            <span className="text-slate-600">/</span>
            <div>
              <span className="text-2xl font-black text-rose-400">{metrics.revokedPasses}</span>
              <span className="text-[10px] text-slate-400 ml-1">Revoked</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Batch consumer: 10 msg/batch</p>
        </div>
      </div>

      {/* Two Column Section: Live APNs Push Stream & Transactional Resend Emails */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live APNs / FCM Push Activity Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Live Silent Push Updates (APNs / FCM)</h3>
                <p className="text-[11px] text-slate-400">Lockscreen changes pushed without pass re-install</p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Live Stream
            </span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[360px]">
            {recentPushes.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                No recent push events logged yet. Edit a participant in the Races tab to trigger a live update!
              </div>
            ) : (
              recentPushes.map((push: any) => (
                <div
                  key={push.id}
                  className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 transition-all flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-white truncate">{push.runner_name}</span>
                      <span className="text-[10px] font-mono bg-sky-950 text-sky-400 px-1.5 py-0.5 rounded">
                        {push.field_changed}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-1.5">
                      <span className="line-through text-slate-500 truncate">{push.old_value}</span>
                      <span>→</span>
                      <span className="text-emerald-400 font-medium truncate">{push.new_value}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[10px] text-slate-500">
                      {new Date(push.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={() => onOpenRunnerPass(push.runner_id)}
                      className="block text-[10px] text-sky-400 hover:underline mt-1 cursor-pointer"
                    >
                      View Pass
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Resend Transactional Email Delivery Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                <Mail className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Resend Email Gateway Activity</h3>
                <p className="text-[11px] text-slate-400">Transactional delivery of pass magic links</p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              Resend API
            </span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[360px]">
            {recentEmails.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                No recent emails logged. Trigger pass delivery or use the lookup page to test!
              </div>
            ) : (
              recentEmails.map((email: any) => (
                <div
                  key={email.id}
                  className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 transition-all flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-purple-300 truncate">{email.to}</span>
                      <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded">
                        {email.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1 truncate">{email.subject}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[10px] text-slate-500">
                      {new Date(email.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={() => onOpenRunnerPass(email.runner_id)}
                      className="block text-[10px] text-sky-400 hover:underline mt-1 cursor-pointer"
                    >
                      Open Link
                    </button>
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
