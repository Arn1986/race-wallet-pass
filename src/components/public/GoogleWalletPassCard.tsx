import React from 'react';
import { Runner, PassTemplate, Race, Pass, getWalletColorPreset } from '../../types/index.ts';
import { QrCode, Sparkles, CheckCircle2, AlertTriangle, Barcode } from 'lucide-react';

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

  const barcodeFormat = schema.barcodeFormat || 'QR';
  const bibValue = resolveVal('bib', '1042');
  const barcodeAltText = schema.barcodeAltText
    ? schema.barcodeAltText.replace('{{bib}}', bibValue)
    : `BIB #${bibValue} • ${runner.first_name} ${runner.last_name}`;

  return (
    <div className="relative mx-auto w-full max-w-[340px] sm:max-w-[360px] select-none">
      <div 
        className="rounded-[28px] shadow-2xl overflow-hidden flex flex-col border border-white/10"
        style={{
          backgroundColor: preset.bgHex,
          color: preset.textHex,
        }}
      >
        {/* Google Wallet Header Pill */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-white/10 bg-black/20">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
            </div>
            <span className="text-xs font-semibold tracking-wide text-white">Google Wallet</span>
          </div>

          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/90 border border-white/10">
            EVENT PASS
          </span>
        </div>

        {isRevoked && (
          <div className="bg-red-600 text-white text-[11px] font-bold py-1 px-3 text-center flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> PASS REVOKED
          </div>
        )}

        {/* Card Body */}
        <div className="p-5 pb-4">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/10 border border-white/10 flex-shrink-0 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white/90" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: preset.labelHex }}>
                {orgName}
              </p>
              <h3 className="text-sm font-bold text-white leading-tight truncate">{logoText}</h3>
            </div>
          </div>

          {/* Primary Bib Card */}
          <div className="bg-black/30 rounded-2xl p-4 border border-white/10 mb-3 text-center">
            <p className="text-[10px] uppercase font-bold tracking-wider" style={{ color: preset.labelHex }}>
              {primaryField.label}
            </p>
            <p className="text-5xl font-black font-mono tracking-tight text-white my-1">
              {primaryField.value || resolveVal(primaryField.key || 'bib', '1042')}
            </p>
            <p className="text-xs font-medium text-white/90">
              {runner.first_name} {runner.last_name}
            </p>
          </div>

          {/* Details (HeaderField & Secondary Fields) */}
          <div className="grid grid-cols-2 gap-2 text-xs bg-black/20 p-3 rounded-2xl border border-white/10 mb-3">
            <div>
              <p className="text-[9px] uppercase font-bold" style={{ color: preset.labelHex }}>
                {headerField.label}
              </p>
              <p className="font-semibold text-white truncate">
                {headerField.value || resolveVal(headerField.key || 'wave', 'Wave A')}
              </p>
            </div>
            {secondaryFields.slice(0, 1).map((f: any, i: number) => (
              <div key={i}>
                <p className="text-[9px] uppercase font-bold" style={{ color: preset.labelHex }}>
                  {f.label}
                </p>
                <p className="font-semibold text-white truncate">
                  {f.key === 'runner_name' ? `${runner.first_name} ${runner.last_name}` : (f.value || resolveVal(f.key || 'category', '-'))}
                </p>
              </div>
            ))}
            {secondaryFields.length > 1 && (
              <div className="col-span-2 pt-1 border-t border-white/10">
                <p className="text-[9px] uppercase font-bold" style={{ color: preset.labelHex }}>
                  {secondaryFields[1].label}
                </p>
                <p className="font-semibold text-white truncate">
                  {secondaryFields[1].value || resolveVal(secondaryFields[1].key || 'category', '-')}
                </p>
              </div>
            )}
          </div>

          {/* QR Code Barcode */}
          <div className="bg-white rounded-2xl p-3 flex flex-col items-center">
            {barcodeFormat === 'Code128' ? (
              <div className="w-full h-16 flex items-center justify-center text-slate-900">
                <Barcode className="w-full h-full" />
              </div>
            ) : (
              <QrCode className="w-24 h-24 sm:w-28 sm:h-28 text-slate-900" strokeWidth={1.6} />
            )}
            <p className="text-[9px] font-mono text-slate-700 mt-1.5 uppercase font-semibold text-center max-w-[240px] truncate">
              {barcodeAltText}
            </p>
          </div>
        </div>

        <div className="p-3 bg-black/30 border-t border-white/10 text-center">
          <p className="text-[10px] text-white/70 flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Connected to Google Wallet Pay Services
          </p>
        </div>
      </div>
    </div>
  );
};
