import React, { useState } from 'react';
import { Runner, PassTemplate, Race, Pass } from '../../types/index.ts';
import { QrCode, RotateCw, ShieldAlert, Sparkles, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

interface AppleWalletPassCardProps {
  runner: Runner;
  race: Race;
  template: PassTemplate;
  pass?: Pass;
  isFlipped?: boolean;
  onFlip?: () => void;
  interactive?: boolean;
}

export const AppleWalletPassCard: React.FC<AppleWalletPassCardProps> = ({
  runner,
  race,
  template,
  pass,
  isFlipped = false,
  onFlip,
  interactive = true,
}) => {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const flipped = onFlip ? isFlipped : internalFlipped;
  const toggleFlip = () => {
    if (onFlip) onFlip();
    else setInternalFlipped(!internalFlipped);
  };

  let dynamicData: Record<string, any> = {};
  try {
    dynamicData = JSON.parse(runner.dynamic_data || '{}');
  } catch {
    dynamicData = {};
  }

  let schema: any = {};
  try {
    schema = JSON.parse(template.schema_definition || '{}');
  } catch {
    schema = {};
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
    if (fieldKey === 'category') return dynamicData.race_division || dynamicData.category || 'Marathon 42K';
    if (fieldKey === 'wave') return dynamicData.start_wave || dynamicData.wave || 'Wave A';
    return fallback;
  };

  const isRevoked = pass?.status === 'revoked';

  const primaryFields = schema.primaryFields || [{ key: 'bib', label: 'BIB NUMBER' }];
  const secondaryFields = schema.secondaryFields || [
    { key: 'category', label: 'CATEGORY' },
    { key: 'wave', label: 'START WAVE' },
  ];
  const auxiliaryFields = schema.auxiliaryFields || [
    { key: 'corral', label: 'CORRAL GATE' },
    { key: 'expected_pace', label: 'TARGET PACE' },
    { key: 'tshirt_size', label: 'SHIRT' },
  ];
  const backFields = schema.backFields || [
    { key: 'emergency_contact', label: 'Emergency Contact' },
    { key: 'medical_notes', label: 'Medical Notes' },
    { key: 'bag_drop_zone', label: 'Bag Drop Zone' },
    { key: 'race_rules', label: 'Official Rules' },
  ];

  const bgColor = template.background_color || '#0f172a';
  const textColor = template.text_color || '#ffffff';
  const labelColor = template.label_color || '#38bdf8';

  return (
    <div
      className="relative mx-auto w-full max-w-[340px] sm:max-w-[360px] select-none"
      style={{ perspective: '1200px' }}
    >
      {/* 3D Card Container */}
      <div
        className={`relative w-full transition-transform duration-700 transform-style-3d ${
          flipped ? 'rotate-y-180' : ''
        }`}
        style={{ minHeight: '520px' }}
      >
        {/* ================= CARD FRONT ================= */}
        <div
          className={`absolute inset-0 backface-hidden rounded-[26px] shadow-2xl overflow-hidden flex flex-col border ${
            isRevoked ? 'border-red-500/50 grayscale-[0.6]' : 'border-white/10'
          }`}
          style={{
            backgroundColor: bgColor,
            color: textColor,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Top Notch / Apple Wallet Header */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-white/5 relative z-10">
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 flex items-center justify-center p-0.5 border border-white/10">
                {template.logo_image_url ? (
                  <img src={template.logo_image_url} alt="Logo" className="w-full h-full object-cover rounded-md" />
                ) : (
                  <Sparkles className="w-4 h-4 text-white/80" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-semibold tracking-wider opacity-75 truncate" style={{ color: labelColor }}>
                  PACIFIC ATHLETIC CLUB
                </p>
                <h4 className="text-xs font-bold truncate leading-tight">{race.name}</h4>
              </div>
            </div>

            {interactive && (
              <button
                type="button"
                onClick={toggleFlip}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                title="Flip to pass back details"
              >
                <Info className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Revoked Banner */}
          {isRevoked && (
            <div className="bg-red-600 text-white text-[11px] font-bold py-1 px-3 text-center flex items-center justify-center gap-1.5 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" /> PASS REVOKED BY ORGANIZER
            </div>
          )}

          {/* Strip Image Banner */}
          <div className="relative h-28 w-full overflow-hidden bg-slate-800 flex-shrink-0">
            {template.strip_image_url ? (
              <img
                src={template.strip_image_url}
                alt="Banner"
                className="w-full h-full object-cover brightness-95"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 flex items-center justify-center">
                <span className="text-white/40 font-mono text-xs">OFFICIAL PARTICIPANT PASS</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute bottom-2 left-4 right-4 flex items-end justify-between">
              <span className="text-[11px] font-medium text-white/90 drop-shadow-md">
                {runner.first_name} {runner.last_name}
              </span>
              <span className="text-[10px] font-mono uppercase bg-black/40 px-2 py-0.5 rounded backdrop-blur-md text-white/80">
                {pass?.status === 'issued' ? 'VERIFIED' : pass?.status}
              </span>
            </div>
          </div>

          {/* Primary Fields (Hero Bib) */}
          <div className="px-5 pt-3 pb-2 text-center border-b border-white/5">
            {primaryFields.map((field: any, idx: number) => (
              <div key={idx} className="my-0.5">
                <p className="text-[10px] uppercase font-bold tracking-widest opacity-80" style={{ color: labelColor }}>
                  {field.label}
                </p>
                <p className="text-4xl sm:text-5xl font-black tracking-tight leading-none font-mono my-1 drop-shadow">
                  {resolveVal(field.key, '1042')}
                </p>
              </div>
            ))}
          </div>

          {/* Secondary Fields (Category & Wave) */}
          <div className="px-5 py-2.5 grid grid-cols-2 gap-2 border-b border-white/5">
            {secondaryFields.map((field: any, idx: number) => (
              <div key={idx} className={field.alignment === 'right' ? 'text-right' : 'text-left'}>
                <p className="text-[9px] uppercase font-bold tracking-wider opacity-80 truncate" style={{ color: labelColor }}>
                  {field.label}
                </p>
                <p className="text-sm font-semibold truncate leading-tight">
                  {resolveVal(field.key, '-')}
                </p>
              </div>
            ))}
          </div>

          {/* Auxiliary Fields (Corral, Pace, Shirt) */}
          <div className="px-5 py-2 grid grid-cols-3 gap-1 border-b border-white/5">
            {auxiliaryFields.map((field: any, idx: number) => (
              <div key={idx} className={idx === 1 ? 'text-center' : idx === 2 ? 'text-right' : 'text-left'}>
                <p className="text-[9px] uppercase font-bold tracking-wider opacity-80 truncate" style={{ color: labelColor }}>
                  {field.label}
                </p>
                <p className="text-xs font-semibold truncate">
                  {field.key === 'runner_name' ? `${runner.first_name} ${runner.last_name}` : resolveVal(field.key, '-')}
                </p>
              </div>
            ))}
          </div>

          {/* Barcode & Apple Wallet Bottom Section */}
          <div className="mt-auto px-5 pt-3 pb-4 bg-white/5 flex flex-col items-center justify-center">
            <div className="bg-white p-2.5 rounded-xl shadow-inner flex flex-col items-center">
              <div className="w-28 h-28 relative flex items-center justify-center">
                <QrCode className="w-full h-full text-slate-900" strokeWidth={1.5} />
              </div>
            </div>
            <p className="text-[9px] font-mono uppercase tracking-wider mt-2 opacity-70 text-center max-w-[240px] truncate" style={{ color: labelColor }}>
              {schema.barcodeAltText || `BIB #${resolveVal('bib', '1042')} • ${runner.first_name} ${runner.last_name}`}
            </p>
          </div>
        </div>

        {/* ================= CARD BACK ================= */}
        <div
          className={`absolute inset-0 backface-hidden rotate-y-180 rounded-[26px] shadow-2xl overflow-hidden flex flex-col border border-white/10 ${
            isRevoked ? 'grayscale-[0.6]' : ''
          }`}
          style={{
            backgroundColor: bgColor,
            color: textColor,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          }}
        >
          {/* Back Header */}
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Pass Details & Instructions</h4>
            </div>
            {interactive && (
              <button
                type="button"
                onClick={toggleFlip}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                title="Flip to pass front"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Back Body Content */}
          <div className="p-5 flex-1 overflow-y-auto space-y-4 text-left text-xs">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: labelColor }}>
                Event Location & Time
              </p>
              <p className="font-semibold text-white/95">{race.location}</p>
              <p className="text-[11px] text-white/70">
                {new Date(race.event_date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>

            {backFields.map((field: any, idx: number) => (
              <div key={idx} className="border-b border-white/5 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor }}>
                  {field.label}
                </p>
                <p className="text-xs text-white/85 mt-0.5 leading-relaxed">
                  {resolveVal(field.key, 'Contact event staff at information booth.')}
                </p>
              </div>
            ))}

            <div className="border-b border-white/5 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor }}>
                Pass Serial Identifier
              </p>
              <p className="font-mono text-[10px] text-white/60 break-all">
                {pass?.walletwallet_pass_id || pass?.id || runner.id}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/20 text-[11px] text-emerald-300">
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Automatic Lock Screen Updates
              </div>
              <p className="text-[10px] opacity-80 leading-normal">
                Organizers send live wave alerts, weather updates, and corral timing directly to this pass via APNs and FCM push notifications.
              </p>
            </div>
          </div>

          <div className="p-3 bg-white/5 border-t border-white/5 text-center">
            <p className="text-[10px] text-white/50">
              Pacific Athletic Club • Powered by Cloudflare D1 & R2
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
