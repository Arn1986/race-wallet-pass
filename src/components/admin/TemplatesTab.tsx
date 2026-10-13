import { buildWalletWalletPayload } from '../../../server/walletPayload.ts';
import React, { useState, useEffect } from 'react';
import { 
  PassTemplate, 
  Runner, 
  Race, 
  WalletColorPreset, 
  WALLET_COLOR_PRESETS, 
  getWalletColorPreset,
  WalletWalletField 
} from '../../types/index.ts';
import { AppleWalletPassCard } from '../public/AppleWalletPassCard.tsx';
import { GoogleWalletPassCard } from '../public/GoogleWalletPassCard.tsx';
import { 
  Sparkles, 
  Save, 
  Plus, 
  Palette, 
  Smartphone, 
  Code, 
  Check, 
  Trash2, 
  Layers, 
  QrCode, 
  Info,
  ExternalLink,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

export const TemplatesTab: React.FC = () => {
  const [templates, setTemplates] = useState<PassTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Active View Tab: 'builder' | 'payload'
  const [activeViewTab, setActiveViewTab] = useState<'builder' | 'payload'>('builder');

  // Preview Platform: 'apple' | 'google'
  const [previewPlatform, setPreviewPlatform] = useState<'apple' | 'google'>('apple');
  const [isFlipped, setIsFlipped] = useState(false);

  // WalletWallet Standard Fields
  const [name, setName] = useState('Official Race Digital Pass');
  const [organizationName, setOrganizationName] = useState('3F Striders');
  const [logoText, setLogoText] = useState('Golden Gate Marathon 2026');
  const [description, setDescription] = useState('Official 2026 Participant Race Pass');
  const [colorPreset, setColorPreset] = useState<WalletColorPreset>('dark');
  const [barcodeFormat, setBarcodeFormat] = useState<'QR' | 'Code128' | 'PDF417' | 'Aztec'>('QR');
  const [barcodeAltText, setBarcodeAltText] = useState('BIB #{{bib}}');

  // Front fields
  const [headerLabel, setHeaderLabel] = useState('WAVE');
  const [headerKey, setHeaderKey] = useState('wave');

  const [primaryLabel, setPrimaryLabel] = useState('BIB NUMBER');
  const [primaryKey, setPrimaryKey] = useState('bib');

  const [sec1Label, setSec1Label] = useState('PARTICIPANT');
  const [sec1Key, setSec1Key] = useState('runner_name');

  const [sec2Label, setSec2Label] = useState('DIVISION');
  const [sec2Key, setSec2Key] = useState('category');

  // Back fields
  const [backFields, setBackFields] = useState<WalletWalletField[]>([
    { label: 'Emergency Contact', key: 'emergency_contact' },
    { label: 'Runner Email', key: 'email' },
    { label: 'Official Rules', value: 'Present QR at start chute check-in and finish village medal chute.' },
  ]);

  const [sharingProhibited, setSharingProhibited] = useState(false);
  const [loadedSchema, setLoadedSchema] = useState<Record<string, any>>({});

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/templates');
      const json: any = await res.json();
      if (json.success && json.data.length > 0) {
        setTemplates(json.data);
        if (!selectedId && !isCreatingNew) {
          loadTemplateIntoForm(json.data[0]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setSaveError(err.message || 'Failed to fetch templates from D1');
    } finally {
      setLoading(false);
    }
  };

  const handleStartNewTemplate = () => {
    setLoadedSchema({});
    setIsCreatingNew(true);
    setSelectedId('');
    setName('New Race Pass');
    setOrganizationName('3F Striders');
    setLogoText('Golden Gate Marathon 2026');
    setDescription('Official Participant Digital Pass');
    setColorPreset('dark');
    setBarcodeFormat('QR');
    setBarcodeAltText('BIB #{{bib}}');
    setHeaderLabel('WAVE');
    setHeaderKey('wave');
    setPrimaryLabel('BIB NUMBER');
    setPrimaryKey('bib');
    setSec1Label('PARTICIPANT');
    setSec1Key('runner_name');
    setSec2Label('DIVISION');
    setSec2Key('category');
    setBackFields([
      { label: 'Emergency Contact', key: 'emergency_contact' },
      { label: 'Runner Email', key: 'email' },
      { label: 'Official Rules', value: 'Present QR at start chute check-in and finish village medal chute.' },
    ]);
    setSharingProhibited(false);
    setSaveError(null);
  };

  const loadTemplateIntoForm = (tpl: PassTemplate) => {
    setIsCreatingNew(false);
    setSelectedId(tpl.id);
    setName(tpl.name);
    setSaveError(null);

    let schema: any = {};
    try { schema = JSON.parse(tpl.schema_definition || '{}'); } catch {}
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) schema = {};
    setLoadedSchema(schema);
    setOrganizationName(schema.organizationName ?? '3F Striders');
    setLogoText(schema.logoText ?? tpl.name);
    setDescription(schema.description ?? 'Official Participant Digital Pass');
    setColorPreset(getWalletColorPreset(schema.colorPreset || tpl.background_color).id);
    setBarcodeFormat(schema.barcodeFormat ?? ({ PKBarcodeFormatCode128: 'Code128', PKBarcodeFormatPDF417: 'PDF417', PKBarcodeFormatAztec: 'Aztec' } as any)[schema.barcodeType] ?? 'QR');
    setBarcodeAltText(schema.barcodeAltText ?? 'BIB #{{bib}}');
    setHeaderLabel(schema.headerFields?.[0]?.label ?? 'WAVE');
    setHeaderKey(schema.headerFields?.[0] ? schema.headerFields[0].key ?? '' : 'wave');
    setPrimaryLabel(schema.primaryFields?.[0]?.label ?? 'BIB NUMBER');
    setPrimaryKey(schema.primaryFields?.[0] ? schema.primaryFields[0].key ?? '' : 'bib');
    setSec1Label(schema.secondaryFields?.[0]?.label ?? 'PARTICIPANT');
    setSec1Key(schema.secondaryFields?.[0] ? schema.secondaryFields[0].key ?? '' : 'runner_name');
    setSec2Label(schema.secondaryFields?.[1]?.label ?? 'DIVISION');
    setSec2Key(schema.secondaryFields?.[1] ? schema.secondaryFields[1].key ?? '' : 'category');
    setBackFields(Array.isArray(schema.backFields) ? schema.backFields : [
      { label: 'Emergency Contact', key: 'emergency_contact' },
      { label: 'Runner Email', key: 'email' },
      { label: 'Official Rules', value: 'Present QR at check-in.' },
    ]);
    setSharingProhibited(schema.sharingProhibited ?? false);
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleSelectTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (tpl) {
      loadTemplateIntoForm(tpl);
    }
  };

  const handleAddBackField = () => {
    setBackFields([...backFields, { label: 'Additional Information', value: 'Details' }]);
  };

  const handleRemoveBackField = (index: number) => {
    setBackFields(backFields.filter((_, i) => i !== index));
  };

  const handleUpdateBackField = (index: number, key: 'label' | 'value' | 'key', val: string) => {
    const updated = [...backFields];
    updated[index] = { ...updated[index], [key]: val };
    setBackFields(updated);
  };

  const makeSchema = () => {
    const { color: _legacyCustomColor, ...preserved } = loadedSchema;
    return {
      ...preserved,
      organizationName: organizationName.trim().slice(0, 64),
      logoText: logoText.trim().slice(0, 64),
      description: description.trim().slice(0, 128),
      colorPreset, barcodeFormat, barcodeAltText,
      headerFields: [{ ...loadedSchema.headerFields?.[0], label: headerLabel.trim(), key: headerKey.trim() }, ...(loadedSchema.headerFields?.slice(1) || [])],
      primaryFields: [{ ...loadedSchema.primaryFields?.[0], label: primaryLabel.trim(), key: primaryKey.trim() }, ...(loadedSchema.primaryFields?.slice(1) || [])],
      secondaryFields: [
        { ...loadedSchema.secondaryFields?.[0], label: sec1Label.trim(), key: sec1Key.trim() },
        { ...loadedSchema.secondaryFields?.[1], label: sec2Label.trim(), key: sec2Key.trim() },
        ...(loadedSchema.secondaryFields?.slice(2) || []),
      ],
      backFields: backFields.map(field => ({ ...field, label: String(field.label ?? '').trim(), key: field.key?.trim(), value: field.value === undefined ? undefined : String(field.value).trim() })),
      sharingProhibited,
    };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const activeColorPreset = WALLET_COLOR_PRESETS[colorPreset];

      const schemaPayload = makeSchema();

      const payload = {
        name: name.trim(),
        background_color: activeColorPreset.bgHex,
        text_color: activeColorPreset.textHex,
        label_color: activeColorPreset.labelHex,
        logo_image_url: templates.find(t => t.id === selectedId)?.logo_image_url || '',
        strip_image_url: templates.find(t => t.id === selectedId)?.strip_image_url || '',
        schema_definition: JSON.stringify(schemaPayload),
      };

      const isNew = !selectedId || isCreatingNew;
      const url = isNew ? '/api/templates' : `/api/templates/${selectedId}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json: any = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to save template to D1 database');
      }

      setSaveSuccess(true);
      setIsCreatingNew(false);
      setTimeout(() => setSaveSuccess(false), 4000);

      // Re-fetch templates and select the active one
      const refreshedRes = await fetch('/api/templates');
      const refreshedJson: any = await refreshedRes.json();
      if (refreshedJson.success && refreshedJson.data) {
        setTemplates(refreshedJson.data);
        const activeItem = json.data?.id ? json.data : refreshedJson.data[0];
        if (activeItem) loadTemplateIntoForm(activeItem);
      }
    } catch (err: any) {
      console.error(err);
      setSaveError(err.message || 'Error saving template to Cloudflare D1');
    } finally {
      setSaving(false);
    }
  };

  const activePresetConfig = WALLET_COLOR_PRESETS[colorPreset];

  // Dynamic preview template constructed strictly with WalletWallet fields
  const previewTemplate: PassTemplate = {
    id: selectedId || 'preview-tpl',
    org_id: 'org-3fstriders',
    name,
    background_color: activePresetConfig.bgHex,
    text_color: activePresetConfig.textHex,
    label_color: activePresetConfig.labelHex,
    logo_image_url: templates.find(t => t.id === selectedId)?.logo_image_url || '',
    strip_image_url: templates.find(t => t.id === selectedId)?.strip_image_url || '',
    schema_definition: JSON.stringify(makeSchema()),
    created_at: new Date().toISOString(),
  };

  const previewRunner: Runner = {
    id: 'run-marathon-1042',
    race_id: 'race-gg-marathon-2026',
    first_name: 'Arnold',
    last_name: 'Caisip',
    email: 'arnoldcaisip@gmail.com',
    dynamic_data: JSON.stringify({
      bib: '1042',
      bib_number: '1042',
      category: 'Full Marathon (42.2K)',
      race_division: 'Full Marathon (42.2K)',
      wave: 'Wave A (06:30 AM)',
      start_wave: 'Wave A (06:30 AM)',
      emergency_contact: 'Maria Caisip (+1 415-555-0199)',
    }),
    created_at: new Date().toISOString(),
  };

  const previewRace: Race = {
    id: 'race-gg-marathon-2026',
    org_id: 'org-3fstriders',
    template_id: previewTemplate.id,
    name: logoText || 'Golden Gate Marathon 2026',
    event_date: '2026-11-15T06:30:00Z',
    location: 'San Francisco, CA',
    field_mapping: JSON.stringify({
      bib: 'bib',
      category: 'category',
      wave: 'wave',
      emergency_contact: 'emergency_contact',
    }),
    created_at: new Date().toISOString(),
  };

  // Build sample WalletWallet API request payload
  const sampleWalletWalletPayload = buildWalletWalletPayload({
    runner: previewRunner, template: previewTemplate, raceName: previewRace.name,
    fieldMapping: previewRace.field_mapping, plan: 'pro',
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Pass Studio</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-sky-950 border border-sky-800/80 text-[10px] font-mono font-semibold text-sky-400">
              walletwallet.dev API Standard
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure pass fields and contrast-safe color presets matching WalletWallet specs. Generates official Apple Wallet (.pkpass) and Google Wallet passes.
          </p>
        </div>

        {/* Template Selector Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => handleSelectTemplate(tpl.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                tpl.id === selectedId && !isCreatingNew
                  ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/20'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              {tpl.name}
            </button>
          ))}

          <button
            onClick={handleStartNewTemplate}
            type="button"
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
              isCreatingNew
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-900 text-emerald-400 hover:bg-slate-800 border border-emerald-500/30'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Template</span>
          </button>
        </div>
      </div>

      {/* Two Column Layout: Editor & Real-time Live Pass Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Form Editor (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          {/* Sub-Tabs: Visual Builder vs API Payload Inspector */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setActiveViewTab('builder')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                  activeViewTab === 'builder'
                    ? 'bg-slate-800 text-sky-400 border border-slate-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>WalletWallet Fields</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveViewTab('payload')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                  activeViewTab === 'payload'
                    ? 'bg-slate-800 text-sky-400 border border-slate-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>API Payload (POST /api/passes)</span>
              </button>
            </div>

            <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Strict API Compliance</span>
            </div>
          </div>

          {activeViewTab === 'payload' ? (
            /* API Payload View */
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] text-sky-400 font-bold">
                    POST https://api.walletwallet.dev/api/passes
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Authorization: Bearer WALLETWALLET_API_KEY</span>
                </div>
                <pre className="p-3 bg-slate-900 rounded-xl overflow-x-auto text-[11px] font-mono text-slate-200 leading-relaxed border border-slate-800/80">
                  {JSON.stringify(sampleWalletWalletPayload, null, 2)}
                </pre>
              </div>
              <p className="text-[11px] text-slate-400">
                This JSON is sent directly to WalletWallet. Only fields officially documented on <a href="https://www.walletwallet.dev/docs" target="_blank" rel="noreferrer" className="text-sky-400 underline">walletwallet.dev/docs</a> are transmitted.
              </p>
            </div>
          ) : (
            /* Builder Form */
            <form onSubmit={handleSave} className="space-y-6 text-xs">
              {isCreatingNew && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-emerald-300 flex items-center justify-between text-xs">
                  <span>✨ Creating a new WalletWallet pass template.</span>
                  <button
                    type="button"
                    onClick={() => templates.length > 0 && loadTemplateIntoForm(templates[0])}
                    className="text-[11px] underline text-emerald-400 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {saveError && (
                <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-2xl text-rose-300 text-xs">
                  ⚠️ {saveError}
                </div>
              )}

              {saveSuccess && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-2xl text-emerald-300 text-xs flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" /> Pass template saved successfully to Cloudflare D1.
                </div>
              )}

              {/* 1. Internal Template Name */}
              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1.5">
                  Template Name (Internal Reference)
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Marathon VIP Digital Pass"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none"
                />
              </div>

              {/* 2. WalletWallet Color Presets (6 Presets Exclusively) */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-sky-400" /> WalletWallet Color Preset
                  </span>
                  <span className="text-[10px] text-sky-400 font-mono">
                    Free Tier Safe Presets (6 Available)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  All plans support these colorPreset values. Preview shades are illustrative; WalletWallet controls the installed preset colors. Custom hex color requires Pro.
                </p>

                {/* 6 Preset Buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                  {(Object.keys(WALLET_COLOR_PRESETS) as WalletColorPreset[]).map((presetKey) => {
                    const preset = WALLET_COLOR_PRESETS[presetKey];
                    const isSelected = colorPreset === presetKey;

                    return (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() => setColorPreset(presetKey)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-slate-900 border-sky-400 shadow-md ring-1 ring-sky-400/50'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          {/* Color Dot Swatch */}
                          <div 
                            className="w-5 h-5 rounded-full border border-white/20 shadow-inner flex items-center justify-center"
                            style={{ backgroundColor: preset.bgHex }}
                          >
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${preset.badgeClass}`}>
                            {preset.id}
                          </span>
                        </div>
                        <div>
                          <p className="font-bold text-white text-xs">{preset.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{preset.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Pass Identity: organizationName, logoText, description */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" /> Pass Header & Identity
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">
                      organizationName (Issuer Name)
                    </label>
                    <input
                      type="text"
                      maxLength={64}
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="e.g. 3F Striders"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none text-xs"
                    />
                    <p className="text-[9px] text-slate-500 mt-1">Shown in lock screen notifications (max 64 chars)</p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">
                      logoText (Pass Header Title)
                    </label>
                    <input
                      type="text"
                      maxLength={64}
                      value={logoText}
                      onChange={(e) => setLogoText(e.target.value)}
                      placeholder="e.g. Golden Gate Marathon 2026"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none text-xs"
                    />
                    <p className="text-[9px] text-slate-500 mt-1">Rendered at top-left of the pass face (max 64 chars)</p>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    description (Pass Summary)
                  </label>
                  <input
                    type="text"
                    maxLength={128}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Official Participant Digital Pass"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none text-xs"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Accessibility and Wallet details description (max 128 chars)</p>
                </div>
              </div>

              {/* 4. Barcode Settings */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-sky-400" /> Barcode & Alt Text
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">
                      barcodeFormat
                    </label>
                    <select
                      value={barcodeFormat}
                      onChange={(e: any) => setBarcodeFormat(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none text-xs cursor-pointer"
                    >
                      <option value="QR">QR Code (Recommended for Turnstiles & Chutes)</option>
                      <option value="Code128">Code128 (1D Barcode for Handheld Scanners)</option>
                      <option value="PDF417">PDF417 (Dense 2D)</option>
                      <option value="Aztec">Aztec (High Speed 2D)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">
                      barcodeAltText Template
                    </label>
                    <input
                      type="text"
                      value={barcodeAltText}
                      onChange={(e) => setBarcodeAltText(e.target.value)}
                      placeholder="BIB #{{bib}}"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none text-xs font-mono"
                    />
                    <p className="text-[9px] text-slate-500 mt-1">Rendered below barcode. Use {'{{bib}}'} placeholder.</p>
                  </div>
                </div>
              </div>

              {/* 5. Card Front Fields: headerFields, primaryFields, secondaryFields */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-sky-400" /> Card Face Fields
                </span>

                {/* Header Field & Primary Field */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[10px] font-mono font-bold text-sky-400 uppercase block mb-1.5">
                      headerFields[0] (Top Right)
                    </span>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={headerLabel}
                        onChange={(e) => setHeaderLabel(e.target.value)}
                        placeholder="Label: WAVE"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs outline-none"
                      />
                      <input
                        type="text"
                        value={headerKey}
                        onChange={(e) => setHeaderKey(e.target.value)}
                        placeholder="Key: wave"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase block mb-1.5">
                      primaryFields[0] (Hero Field)
                    </span>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={primaryLabel}
                        onChange={(e) => setPrimaryLabel(e.target.value)}
                        placeholder="Label: BIB NUMBER"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs outline-none"
                      />
                      <input
                        type="text"
                        value={primaryKey}
                        onChange={(e) => setPrimaryKey(e.target.value)}
                        placeholder="Key: bib"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Secondary Fields */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <span className="text-[10px] font-mono font-bold text-purple-400 uppercase block">
                    secondaryFields (Card Front Details)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Field 1</label>
                      <input
                        type="text"
                        value={sec1Label}
                        onChange={(e) => setSec1Label(e.target.value)}
                        placeholder="Label: PARTICIPANT"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs outline-none mb-1.5"
                      />
                      <input
                        type="text"
                        value={sec1Key}
                        onChange={(e) => setSec1Key(e.target.value)}
                        placeholder="Key: runner_name"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Field 2</label>
                      <input
                        type="text"
                        value={sec2Label}
                        onChange={(e) => setSec2Label(e.target.value)}
                        placeholder="Label: DIVISION"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs outline-none mb-1.5"
                      />
                      <input
                        type="text"
                        value={sec2Key}
                        onChange={(e) => setSec2Key(e.target.value)}
                        placeholder="Key: category"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 6. Card Back Fields (backFields) */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-sky-400" /> backFields (Pass Back Information)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddBackField}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add Back Field
                  </button>
                </div>

                <div className="space-y-2">
                  {backFields.map((field, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => handleUpdateBackField(idx, 'label', e.target.value)}
                          placeholder="Label (e.g. Official Rules)"
                          className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs outline-none"
                        />
                        <input
                          type="text"
                          value={field.key || ''}
                          onChange={(e) => handleUpdateBackField(idx, 'key', e.target.value)}
                          placeholder="Participant data key (e.g. email)"
                          aria-label={`Back field ${idx + 1} participant data key`}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs outline-none"
                        />
                        <input
                          type="text"
                          value={field.value || ''}
                          onChange={(e) => handleUpdateBackField(idx, 'value', e.target.value)}
                          placeholder="Static value (used when data key is empty)"
                          aria-label={`Back field ${idx + 1} static value`}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveBackField(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer"
                        title="Remove field"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 7. Action Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3.5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold transition-all shadow-lg shadow-sky-500/20 flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving to Cloudflare D1...' : 'Save Pass Template'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Column: Live Wallet Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-4 sticky top-6">
          {/* Platform View Selector */}
          <div className="bg-slate-900 border border-slate-800 p-2 rounded-2xl flex items-center justify-between">
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setPreviewPlatform('apple')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  previewPlatform === 'apple'
                    ? 'bg-slate-800 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Apple Wallet</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewPlatform('google')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  previewPlatform === 'google'
                    ? 'bg-slate-800 text-white shadow'
                    : 'text-slate-400 hover:text-white'
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

            {previewPlatform === 'apple' && (
              <button
                type="button"
                onClick={() => setIsFlipped(!isFlipped)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>{isFlipped ? 'Front' : 'Back'}</span>
              </button>
            )}
          </div>

          {/* Pass Visual Preview */}
          <div className="py-2">
            {previewPlatform === 'apple' ? (
              <AppleWalletPassCard
                runner={previewRunner}
                race={previewRace}
                template={previewTemplate}
                isFlipped={isFlipped}
                onFlip={() => setIsFlipped(!isFlipped)}
              />
            ) : (
              <GoogleWalletPassCard
                runner={previewRunner}
                race={previewRace}
                template={previewTemplate}
              />
            )}
          </div>

          {/* Preset Information Banner */}
          <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div 
                className="w-3.5 h-3.5 rounded-full border border-white/20"
                style={{ backgroundColor: activePresetConfig.bgHex }}
              />
              <span className="font-semibold text-white">Preset: {activePresetConfig.name}</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">{activePresetConfig.bgHex}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
