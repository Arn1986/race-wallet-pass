import React, { useState } from 'react';
import { Runner, PassTemplate, Race, Pass, getWalletColorPreset } from '../../types/index.ts';
import { QrCode, RotateCw, ShieldAlert, Sparkles, CheckCircle2, AlertTriangle, Info, Barcode } from 'lucide-react';

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
    if (fieldKey === 'bib' || fieldKey === 'bib_number') return dynamicData.bib_number || dynamicData.bib || '1042';
    if (fieldKey === 'category' || fieldKey === 'division') return dynamicData.race_division || dynamicData.category || dynamicData.division || 'Full Marathon (42.2K)';
    if (fieldKey === 'wave' || fieldKey === 'start_wave') return dynamicData.start_wave || dynamicData.wave || 'Wave A';
    if (fieldKey === 'runner_name') return `${runner.first_name} ${runner.last_name}`;
    if (fieldKey === 'email') return runner.email;
    return fallback;
  };

  const isRevoked = pass?.status === 'revoked';

  // Derive WalletWallet Color Preset styling
  const chosenPresetKey = schema.colorPreset || template.background_color;
  const preset = getWalletColorPreset(chosenPresetKey);

  // WalletWallet standard fields
  const logoText = (schema.logoText || race.name || template.name || 'Athletic Event').slice(0, 64);
  const orgName = (schema.organizationName || '3F Striders').slice(0, 64);

  const headerField = schema.headerFields?.[0] || { label: 'WAVE', key: 'wave' };
  const primaryField = schema.primaryFields?.[0] || { label: 'BIB NUMBER', key: 'bib' };
  
  const secondaryFields = (schema.secondaryFields && schema.secondaryFields.length > 0)
    ? schema.secondaryFields
    : [
        { label: 'PARTICIPANT', key: 'runner_name' },
        { label: 'DIVISION', key: 'category' },
      ];

  const backFields = (schema.backFields && schema.backFields.length > 0)
    ? schema.backFields
    : [
        { label: 'Emergency Contact', key: 'emergency_contact', value: resolveVal('emergency_contact', 'Maria Caisip (+1 415-555-0199)') },
        { label: 'Runner Email', key: 'email', value: runner.email },
        { label: 'Official Rules', value: 'Present QR at start chute check-in and finish village medal chute.' },
      ];

  const barcodeFormat = schema.barcodeFormat || 'QR';
  const bibValue = resolveVal('bib', '1042');
  const barcodeAltText = schema.barcodeAltText
    ? schema.barcodeAltText.replace('{{bib}}', bibValue)
    : `BIB #${bibValue} • ${runner.first_name} ${runner.last_name}`;

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
        style={{ minHeight: '480px' }}
      >
        {/* ================= CARD FRONT (WalletWallet Apple Wallet Exact Spec) ================= */}
        <div
          className={`absolute inset-0 backface-hidden rounded-[26px] shadow-2xl overflow-hidden flex flex-col border ${
            isRevoked ? 'border-red-500/50 grayscale-[0.6]' : 'border-white/10'
          }`}
          style={{
            backgroundColor: preset.bgHex,
            color: preset.textHex,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Top Header Bar: LogoText (Left) + HeaderField (Right) */}
          <div className="px-5 pt-4 pb-3 flex items-start justify-between border-b border-white/10 relative z-10">
            <div className="flex items-center space-x-2.5 overflow-hidden pr-2">
              <div className="w-7 h-7 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 flex items-center justify-center p-1 border border-white/10">
                <Sparkles className="w-3.5 h-3.5 text-white/90" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold tracking-wider truncate" style={{ color: preset.labelHex }}>
                  {orgName}
                </p>
                <h4 className="text-xs font-bold truncate leading-tight">{logoText}</h4>
              </div>
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0 text-right">
              <div>
                <p className="text-[9px] uppercase font-bold tracking-wider" style={{ color: preset.labelHex }}>
                  {headerField.label}
                </p>
                <p className="text-xs font-bold leading-tight">
                  {headerField.value || resolveVal(headerField.key || 'wave', 'Wave A')}
                </p>
              </div>

              {interactive && (
                <button
                  type="button"
                  onClick={toggleFlip}
                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer ml-1"
                  title="Flip to pass back details"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Revoked Banner */}
          {isRevoked && (
            <div className="bg-red-600 text-white text-[11px] font-bold py-1 px-3 text-center flex items-center justify-center gap-1.5 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" /> PASS REVOKED BY ORGANIZER
            </div>
          )}

          {/* Primary Field (Hero Bib Number) */}
          <div className="px-5 pt-6 pb-4 text-center">
            <p className="text-[10px] uppercase font-extrabold tracking-widest opacity-85" style={{ color: preset.labelHex }}>
              {primaryField.label}
            </p>
            <p className="text-5xl sm:text-6xl font-black tracking-tight leading-none font-mono my-2 drop-shadow">
              {primaryField.value || resolveVal(primaryField.key || 'bib', '1042')}
            </p>
            <span className="inline-block text-[10px] font-mono uppercase bg-black/30 px-2.5 py-0.5 rounded-full border border-white/10 text-white/80">
              {pass?.status === 'issued' ? 'Official Wallet Pass' : 'Ready to Install'}
            </span>
          </div>

          {/* Secondary Fields (2 columns: Participant & Division) */}
          <div className="px-5 py-3 grid grid-cols-2 gap-3 border-t border-b border-white/10 bg-black/10">
            {secondaryFields.slice(0, 2).map((field: any, idx: number) => {
              const val = field.key === 'runner_name'
                ? `${runner.first_name} ${runner.last_name}`
                : (field.value || resolveVal(field.key || 'category', '-'));
              return (
                <div key={idx} className={idx === 1 ? 'text-right' : 'text-left'}>
                  <p className="text-[9px] uppercase font-bold tracking-wider truncate" style={{ color: preset.labelHex }}>
                    {field.label}
                  </p>
                  <p className="text-sm font-semibold truncate leading-tight mt-0.5">
                    {val}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Barcode Section (WalletWallet Official Spec: Centered on Clean White Card) */}
          <div className="mt-auto px-5 pt-4 pb-4 bg-black/20 flex flex-col items-center justify-center border-t border-white/10">
            <div className="bg-white p-3 rounded-2xl shadow-lg flex flex-col items-center max-w-[200px] w-full">
              {barcodeFormat === 'Code128' ? (
                <div className="w-full h-16 flex items-center justify-center text-slate-900">
                  <Barcode className="w-full h-full" />
                </div>
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 relative flex items-center justify-center">
                  <QrCode className="w-full h-full text-slate-900" strokeWidth={1.6} />
                </div>
              )}
            </div>
            <p className="text-[10px] font-mono uppercase tracking-wider mt-2.5 opacity-80 text-center max-w-[260px] truncate" style={{ color: preset.labelHex }}>
              {barcodeAltText}
            </p>
          </div>
        </div>

        {/* ================= CARD BACK (WalletWallet Back Fields Spec) ================= */}
        <div
          className={`absolute inset-0 backface-hidden rotate-y-180 rounded-[26px] shadow-2xl overflow-hidden flex flex-col border border-white/10 ${
            isRevoked ? 'grayscale-[0.6]' : ''
          }`}
          style={{
            backgroundColor: preset.bgHex,
            color: preset.textHex,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          }}
        >
          {/* Back Header */}
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Pass Details & Information</h4>
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
          <div className="p-5 flex-1 overflow-y-auto space-y-3.5 text-left text-xs">
            {/* Event Summary */}
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: preset.labelHex }}>
                Event Location & Date
              </p>
              <p className="font-semibold text-white/95">{race.location || 'San Francisco, CA'}</p>
              <p className="text-[11px] text-white/70">
                {new Date(race.event_date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>

            {/* Configured WalletWallet Back Fields */}
            {backFields.map((field: any, idx: number) => {
              const val = field.value || resolveVal(field.key, 'Contact organizer staff.');
              return (
                <div key={idx} className="border-b border-white/10 pb-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: preset.labelHex }}>
                    {field.label}
                  </p>
                  <p className="text-xs text-white/90 mt-0.5 leading-relaxed break-words">
                    {val}
                  </p>
                </div>
              );
            })}

            {/* Wallet Serial Number */}
            <div className="border-b border-white/10 pb-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: preset.labelHex }}>
                Pass Serial Number
              </p>
              <p className="font-mono text-[10px] text-white/70 break-all">
                {pass?.walletwallet_pass_id || pass?.id || runner.id}
              </p>
            </div>

            {/* Wallet Notification Notice */}
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/20 text-[11px] text-emerald-300">
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Live Lock Screen Updates
              </div>
              <p className="text-[10px] opacity-80 leading-normal">
                Organizers push wave alerts, corral timing, and emergency notifications directly to this pass via live Wallet push updates.
              </p>
            </div>
          </div>

          <div className="p-3 bg-black/20 border-t border-white/10 text-center">
            <p className="text-[10px] text-white/50">
              {orgName} • Official Digital Event Pass
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
