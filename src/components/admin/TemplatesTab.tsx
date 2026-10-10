import React, { useState, useEffect } from 'react';
import { PassTemplate, Runner, Race } from '../../types/index.ts';
import { AppleWalletPassCard } from '../public/AppleWalletPassCard.tsx';
import { GoogleWalletPassCard } from '../public/GoogleWalletPassCard.tsx';
import { Sparkles, Save, Plus, Palette, Image as ImageIcon, Sliders, Smartphone } from 'lucide-react';

export const TemplatesTab: React.FC = () => {
  const [templates, setTemplates] = useState<PassTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Editable Form State
  const [name, setName] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('#0f172a');
  const [textColor, setTextColor] = useState('#ffffff');
  const [labelColor, setLabelColor] = useState('#38bdf8');
  const [logoImageUrl, setLogoImageUrl] = useState('');
  const [stripImageUrl, setStripImageUrl] = useState('');
  const [barcodeType, setBarcodeType] = useState('PKBarcodeFormatQR');

  // Preview Platform
  const [previewPlatform, setPreviewPlatform] = useState<'apple' | 'google'>('apple');

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
    setIsCreatingNew(true);
    setSelectedId('');
    setName('New Custom Race Pass');
    setBackgroundColor('#0f172a');
    setTextColor('#ffffff');
    setLabelColor('#38bdf8');
    setLogoImageUrl('https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=400&q=80');
    setStripImageUrl('https://images.unsplash.com/photo-1502680390469-be75c86b636f?auto=format&fit=crop&w=1200&q=80');
    setBarcodeType('PKBarcodeFormatQR');
    setSaveError(null);
  };

  const loadTemplateIntoForm = (tpl: PassTemplate) => {
    setIsCreatingNew(false);
    setSelectedId(tpl.id);
    setName(tpl.name);
    setBackgroundColor(tpl.background_color);
    setTextColor(tpl.text_color);
    setLabelColor(tpl.label_color);
    setLogoImageUrl(tpl.logo_image_url || '');
    setStripImageUrl(tpl.strip_image_url || '');
    setSaveError(null);

    try {
      const s = JSON.parse(tpl.schema_definition || '{}');
      if (s.barcodeType) setBarcodeType(s.barcodeType);
    } catch {
      // ignore
    }
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      const current = templates.find((t) => t.id === selectedId);
      let schema: any = {};
      try {
        schema = JSON.parse(current?.schema_definition || '{}');
      } catch {
        schema = {};
      }
      schema.barcodeType = barcodeType;
      if (!schema.primaryFields) {
        schema.primaryFields = [{ key: 'bib', label: 'BIB NUMBER' }];
      }
      if (!schema.secondaryFields) {
        schema.secondaryFields = [
          { key: 'category', label: 'CATEGORY' },
          { key: 'wave', label: 'START WAVE' },
        ];
      }
      if (!schema.auxiliaryFields) {
        schema.auxiliaryFields = [
          { key: 'corral', label: 'CORRAL' },
          { key: 'expected_pace', label: 'TARGET PACE' },
          { key: 'tshirt_size', label: 'SHIRT' },
        ];
      }
      if (!schema.backFields) {
        schema.backFields = [
          { key: 'emergency_contact', label: 'Emergency Contact' },
          { key: 'medical_notes', label: 'Medical Notes' },
          { key: 'race_rules', label: 'Rules & Regulations' },
        ];
      }

      const payload = {
        name,
        background_color: backgroundColor,
        text_color: textColor,
        label_color: labelColor,
        logo_image_url: logoImageUrl,
        strip_image_url: stripImageUrl,
        schema_definition: JSON.stringify(schema),
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

      // Re-fetch templates and select the created/updated one
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

  // Sample runner and race for real-time live preview
  const previewTemplate: PassTemplate = {
    id: selectedId || 'preview-tpl',
    org_id: 'org-pacific-sports-2026',
    name,
    background_color: backgroundColor,
    text_color: textColor,
    label_color: labelColor,
    logo_image_url: logoImageUrl,
    strip_image_url: stripImageUrl,
    schema_definition: JSON.stringify({
      passType: 'eventTicket',
      barcodeType,
      primaryFields: [{ key: 'bib', label: 'BIB NUMBER' }],
      secondaryFields: [
        { key: 'category', label: 'CATEGORY' },
        { key: 'wave', label: 'START WAVE' },
      ],
      auxiliaryFields: [
        { key: 'corral', label: 'CORRAL' },
        { key: 'expected_pace', label: 'TARGET PACE' },
        { key: 'tshirt_size', label: 'SHIRT' },
      ],
      backFields: [
        { key: 'emergency_contact', label: 'Emergency Contact' },
        { key: 'medical_notes', label: 'Medical Notes' },
        { key: 'race_rules', label: 'Rules & Regulations' },
      ],
    }),
    created_at: new Date().toISOString(),
  };

  const previewRunner: Runner = {
    id: 'run-marathon-1042',
    race_id: 'race-gg-marathon-2026',
    first_name: 'Arnold',
    last_name: 'Caisip',
    email: 'arnoldcaisip@gmail.com',
    dynamic_data: JSON.stringify({
      bib_number: '1042',
      race_division: 'Full Marathon (42.2K)',
      start_wave: 'Wave A (06:30 AM)',
      corral_letter: 'Chute Red 1',
      target_pace: '4:15 min/km',
      tshirt_size: 'Men L',
      emergency_contact: 'Maria Caisip (+1 415-555-0199)',
      medical_notes: 'None. Penicillin alert.',
    }),
    created_at: new Date().toISOString(),
  };

  const previewRace: Race = {
    id: 'race-gg-marathon-2026',
    org_id: 'org-pacific-sports-2026',
    template_id: previewTemplate.id,
    name: 'Golden Gate Marathon 2026',
    event_date: '2026-11-15T06:30:00Z',
    location: 'San Francisco, CA',
    field_mapping: JSON.stringify({
      bib: 'bib_number',
      category: 'race_division',
      wave: 'start_wave',
      corral: 'corral_letter',
      expected_pace: 'target_pace',
      tshirt_size: 'tshirt_size',
      emergency_contact: 'emergency_contact',
      medical_notes: 'medical_notes',
    }),
    created_at: new Date().toISOString(),
  };

  // Color Swatches
  const colorPresets = [
    { label: 'Slate Night', bg: '#0f172a', text: '#ffffff', labelCol: '#38bdf8' },
    { label: 'Alpine Emerald', bg: '#064e3b', text: '#ecfdf5', labelCol: '#34d399' },
    { label: 'Midnight Volt', bg: '#18181b', text: '#ffffff', labelCol: '#bef264' },
    { label: 'Deep Crimson', bg: '#4c0519', text: '#fff1f2', labelCol: '#fb7185' },
    { label: 'Electric Blue', bg: '#172554', text: '#eff6ff', labelCol: '#60a5fa' },
    { label: 'Obsidian Black', bg: '#09090b', text: '#fafafa', labelCol: '#a1a1aa' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Apple & Google Pass Template Studio</h2>
          <p className="text-xs text-slate-400">
            Define colors, R2 graphic banners, schema fields, and inspect real-time wallet simulation.
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
                  ? 'bg-sky-500 text-slate-950 font-bold shadow'
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
                ? 'bg-emerald-500 text-slate-950 shadow'
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
          <form onSubmit={handleSave} className="space-y-6 text-xs">
            {/* Creation Mode Indicator or Error Banner */}
            {isCreatingNew && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-emerald-300 flex items-center justify-between text-xs">
                <span>✨ Creating a brand new pass template. Fill details and click Save below.</span>
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

            {/* Template Name */}
            <div>
              <label className="block uppercase font-bold text-slate-400 mb-1.5">
                Template Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white font-medium outline-none"
              />
            </div>

            {/* Color Theme Selector */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-sky-400" /> Pass Colors & Branding
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Apple RGB Spec</span>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap gap-2 pt-1">
                {colorPresets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setBackgroundColor(preset.bg);
                      setTextColor(preset.text);
                      setLabelColor(preset.labelCol);
                    }}
                    className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900 cursor-pointer text-[10px] text-slate-300"
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: preset.bg }} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>

              {/* Exact Color Pickers */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                    Background Color
                  </label>
                  <div className="flex items-center space-x-2 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="w-7 h-7 rounded border-none bg-transparent cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-slate-300">{backgroundColor}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                    Text / Value Color
                  </label>
                  <div className="flex items-center space-x-2 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-7 h-7 rounded border-none bg-transparent cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-slate-300">{textColor}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                    Label Color
                  </label>
                  <div className="flex items-center space-x-2 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
                    <input
                      type="color"
                      value={labelColor}
                      onChange={(e) => setLabelColor(e.target.value)}
                      className="w-7 h-7 rounded border-none bg-transparent cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-slate-300">{labelColor}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Cloudflare R2 Graphics */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-3">
              <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-sky-400" /> Cloudflare R2 Pass Media Assets
              </span>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  Strip Banner URL (375x123px Apple Strip Hero)
                </label>
                <input
                  type="text"
                  value={stripImageUrl}
                  onChange={(e) => setStripImageUrl(e.target.value)}
                  placeholder="https://.../strip.jpg (Cloudflare R2 Public URL)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 outline-none text-[11px]"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  Logo / Badge URL (Small square logo)
                </label>
                <input
                  type="text"
                  value={logoImageUrl}
                  onChange={(e) => setLogoImageUrl(e.target.value)}
                  placeholder="https://.../logo.svg (Cloudflare R2 Public URL)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 outline-none text-[11px]"
                />
              </div>
            </div>

            {/* Barcode Format */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-2">
              <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-sky-400" /> Barcode & Scan Technology
              </span>

              <div className="grid grid-cols-3 gap-2 pt-1">
                {['PKBarcodeFormatQR', 'PKBarcodeFormatPDF417', 'PKBarcodeFormatCode128'].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setBarcodeType(type)}
                    className={`py-2 px-2 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${
                      barcodeType === type
                        ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {type.replace('PKBarcodeFormat', '')}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Save Button */}
            <div className="flex items-center justify-between pt-2">
              {saveSuccess ? (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  ✓ Template updated in D1 database!
                </span>
              ) : (
                <span className="text-slate-500 text-[11px]">
                  Updates propagate dynamically to issued passes
                </span>
              )}

              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center space-x-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving to D1...' : isCreatingNew ? 'Create & Save Template in D1' : 'Save Template Changes'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Live Interactive Device Preview (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="mb-4 flex items-center space-x-2 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setPreviewPlatform('apple')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                previewPlatform === 'apple'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Apple Wallet
            </button>
            <button
              onClick={() => setPreviewPlatform('google')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                previewPlatform === 'google'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Google Wallet
            </button>
          </div>

          <div className="w-full flex justify-center">
            {previewPlatform === 'apple' ? (
              <AppleWalletPassCard
                runner={previewRunner}
                race={previewRace}
                template={previewTemplate}
                pass={{
                  id: 'pass-preview',
                  runner_id: previewRunner.id,
                  walletwallet_pass_id: 'ww_preview_pass',
                  status: 'issued',
                  installed_apple: 1,
                  installed_google: 0,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }}
              />
            ) : (
              <GoogleWalletPassCard
                runner={previewRunner}
                race={previewRace}
                template={previewTemplate}
                pass={{
                  id: 'pass-preview',
                  runner_id: previewRunner.id,
                  walletwallet_pass_id: 'ww_preview_pass',
                  status: 'issued',
                  installed_apple: 0,
                  installed_google: 1,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }}
              />
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-3 text-center">
            Live preview rendered from your exact design specification
          </p>
        </div>
      </div>
    </div>
  );
};
