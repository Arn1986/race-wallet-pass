import React from 'react';
import { Runner, PassTemplate, Race, Pass } from '../../types/index.ts';
import { QrCode, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

interface GoogleWalletPassCardProps {
  runner: Runner;
  race: Race;
  template: PassTemplate;
  pass?: Pass;
}

export const GoogleWalletPassCard: React.FC<GoogleWalletPassCardProps> = ({
  runner,
  race,
  template,
  pass,
}) => {
  let dynamicData: Record<string, any> = {};
  try {
    dynamicData = JSON.parse(runner.dynamic_data || '{}');
  } catch {
    dynamicData = {};
  }

  let fieldMapping: Record<string, string> = {};
  try {
    fieldMapping = JSON.parse(race.field_mapping || '{}');
  } catch {
    fieldMapping = {};
  }

  const resolveVal = (fieldKey: string, fallback: string = '-') => {
    const mapped = fieldMapping[fieldKey] || fieldKey;
    if (dynamicData[mapped] !== undefined && dynamicData[mapped] !== '') return String(dynamicData[mapped]);
    if (dynamicData[fieldKey] !== undefined && dynamicData[fieldKey] !== '') return String(dynamicData[fieldKey]);
    if (fieldKey === 'bib') return dynamicData.bib_number || dynamicData.bib || '1042';
    if (fieldKey === 'category') return dynamicData.race_division || dynamicData.category || 'Marathon';
    if (fieldKey === 'wave') return dynamicData.start_wave || dynamicData.wave || 'Wave A';
    return fallback;
  };

  const isRevoked = pass?.status === 'revoked';

  return (
    <div className="relative mx-auto w-full max-w-[340px] sm:max-w-[360px] select-none">
      <div className="rounded-[28px] bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden text-white flex flex-col">
        {/* Google Wallet Header Pill */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
            </div>
            <span className="text-xs font-semibold tracking-wide text-slate-300">Google Wallet</span>
          </div>

          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            EVENT PASS
          </span>
        </div>

        {isRevoked && (
          <div className="bg-red-600 text-white text-[11px] font-bold py-1 px-3 text-center flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> PASS REVOKED
          </div>
        )}

        {/* Hero banner */}
        <div className="p-5 pb-3">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-12 h-12 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0">
              {template.logo_image_url ? (
                <img src={template.logo_image_url} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sky-400">
                  <Sparkles className="w-6 h-6" />
                </div>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Pacific Athletic Club</p>
              <h3 className="text-sm font-bold text-white leading-tight">{race.name}</h3>
            </div>
          </div>

          {/* Primary Bib Card */}
          <div className="bg-slate-800/90 rounded-2xl p-4 border border-slate-700/60 mb-3 text-center">
            <p className="text-[10px] uppercase font-bold text-sky-400 tracking-wider">OFFICIAL BIB NUMBER</p>
            <p className="text-5xl font-black font-mono tracking-tight text-white my-1">
              {resolveVal('bib', '1042')}
            </p>
            <p className="text-xs font-medium text-slate-300">
              {runner.first_name} {runner.last_name}
            </p>
          </div>

          {/* Key Details */}
          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-800/50 p-3 rounded-2xl border border-slate-800 mb-3">
            <div>
              <p className="text-[9px] uppercase font-bold text-slate-400">Division</p>
              <p className="font-semibold text-white truncate">{resolveVal('category', 'Full Marathon')}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase font-bold text-slate-400">Start Wave</p>
              <p className="font-semibold text-white truncate">{resolveVal('wave', 'Wave A')}</p>
            </div>
            <div className="mt-1">
              <p className="text-[9px] uppercase font-bold text-slate-400">Corral</p>
              <p className="font-semibold text-white truncate">{resolveVal('corral', 'Gate 1')}</p>
            </div>
            <div className="mt-1">
              <p className="text-[9px] uppercase font-bold text-slate-400">Target Pace</p>
              <p className="font-semibold text-white truncate">{resolveVal('expected_pace', '4:15 min/km')}</p>
            </div>
          </div>

          {/* QR Code */}
          <div className="bg-white rounded-2xl p-3 flex flex-col items-center">
            <QrCode className="w-28 h-28 text-slate-900" strokeWidth={1.5} />
            <p className="text-[9px] font-mono text-slate-600 mt-1 uppercase font-semibold">
              BIB #{resolveVal('bib', '1042')} • {runner.first_name} {runner.last_name}
            </p>
          </div>
        </div>

        <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 text-center">
          <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Connected to Google Pay Services
          </p>
        </div>
      </div>
    </div>
  );
};
