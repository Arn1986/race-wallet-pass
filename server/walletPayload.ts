import { getWalletColorPreset, WALLET_COLOR_PRESETS } from '../src/types/index.ts';

export interface WalletPayloadOptions {
  runner: { id: string; first_name: string; last_name: string; email: string; dynamic_data?: any };
  template?: { schema_definition?: string; background_color?: string; logo_image_url?: string; strip_image_url?: string; background_image_url?: string };
  raceName: string;
  orgName?: string;
  fieldMapping?: string | Record<string, string>;
  plan?: 'free' | 'pro';
}

function record(value: any): Record<string, any> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function validateTemplateSchema(raw: any): Record<string, any> {
  let schema = raw;
  if (typeof raw === 'string') {
    try { schema = JSON.parse(raw); } catch { throw new Error('Template schema must be valid JSON'); }
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Template schema must be an object');
  if (schema.colorPreset !== undefined && (typeof schema.colorPreset !== 'string' || !Object.hasOwn(WALLET_COLOR_PRESETS, schema.colorPreset))) {
    throw new Error('colorPreset must be dark, blue, green, red, purple, or orange');
  }
  if (schema.barcodeFormat !== undefined && !['QR', 'PDF417', 'Aztec', 'Code128'].includes(schema.barcodeFormat)) {
    throw new Error('barcodeFormat must be QR, PDF417, Aztec, or Code128');
  }
  for (const key of ['organizationName', 'logoText', 'description', 'barcodeAltText']) {
    if (schema[key] !== undefined && typeof schema[key] !== 'string') throw new Error(`${key} must be text`);
  }
  if (schema.sharingProhibited !== undefined && typeof schema.sharingProhibited !== 'boolean') {
    throw new Error('sharingProhibited must be a boolean');
  }
  if (schema.color !== undefined && !/^#[0-9a-f]{6}$/i.test(schema.color)) throw new Error('color must be a six-digit hex color');
  for (const name of ['headerFields', 'primaryFields', 'secondaryFields', 'backFields']) {
    if (schema[name] === undefined) continue;
    if (!Array.isArray(schema[name])) throw new Error(`${name} must be an array`);
    for (const field of schema[name]) {
      if (!field || typeof field !== 'object' || Array.isArray(field)) throw new Error(`${name} must contain field objects`);
      for (const key of ['label', 'key', 'changeMessage']) {
        if (field[key] !== undefined && typeof field[key] !== 'string') throw new Error(`${name}.${key} must be text`);
      }
      if (field.value !== undefined && !['string', 'number', 'boolean'].includes(typeof field.value)) {
        throw new Error(`${name}.value must be text, a number, or a boolean`);
      }
    }
  }
  return schema;
}

// Internal keys are resolved here; WalletWallet receives only documented wire fields.
export function buildWalletWalletPayload(options: WalletPayloadOptions): Record<string, any> {
  const { runner, template, raceName, orgName, plan = 'free' } = options;
  const schema = validateTemplateSchema(record(template?.schema_definition));
  const data = record(runner.dynamic_data);
  const mapping = record(options.fieldMapping);
  const own = (key: string) => Object.hasOwn(data, key) && data[key] !== undefined && data[key] !== null && data[key] !== '';
  const resolve = (key: string): string => {
    if (typeof mapping[key] === 'string' && own(mapping[key])) return String(data[mapping[key]]);
    if (own(key)) return String(data[key]);
    if (key === 'runner_name') return `${runner.first_name} ${runner.last_name}`;
    if (['email', 'first_name', 'last_name'].includes(key)) return String((runner as any)[key] || '');
    const aliases: Record<string, string[]> = {
      bib: ['bib_number'], bib_number: ['bib'], category: ['division', 'race_division'],
      division: ['category', 'race_division'], wave: ['start_wave'], start_wave: ['wave'],
    };
    for (const alias of Object.hasOwn(aliases, key) ? aliases[key] : []) if (own(alias)) return String(data[alias]);
    if (key === 'bib' || key === 'bib_number') return runner.id.replace(/^run-/, '').slice(0, 8).toUpperCase();
    if (key === 'wave' || key === 'start_wave') return 'Open';
    if (key === 'category' || key === 'division') return 'General';
    return '';
  };
  const interpolate = (value: any) => String(value ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => resolve(key));
  const defaults: Record<string, any[]> = {
    headerFields: [{ label: 'WAVE', key: 'wave' }],
    primaryFields: [{ label: 'BIB NUMBER', key: 'bib' }],
    secondaryFields: [{ label: 'PARTICIPANT', key: 'runner_name' }, { label: 'DIVISION', key: 'category' }],
    backFields: [{ label: 'Emergency Contact', key: 'emergency_contact' }, { label: 'Runner Email', key: 'email' },
      { label: 'Official Rules', value: 'Present QR at check-in.' }],
  };
  const fields = (name: string) => (Array.isArray(schema[name]) ? schema[name] : defaults[name]).map((field: any) => ({
    ...(field.label !== undefined ? { label: String(field.label) } : {}),
    // A mapped key always takes priority over legacy preview/sample text.
    value: field.key ? resolve(field.key) : interpolate(field.value),
    ...(field.changeMessage !== undefined ? { changeMessage: String(field.changeMessage) } : {}),
  }));
  const format = schema.barcodeFormat || ({ PKBarcodeFormatQR: 'QR', PKBarcodeFormatPDF417: 'PDF417',
    PKBarcodeFormatAztec: 'Aztec', PKBarcodeFormatCode128: 'Code128' } as Record<string, string>)[schema.barcodeType] || 'QR';
  const body: Record<string, any> = {
    barcodeValue: resolve('bib'), barcodeFormat: format,
    barcodeAltText: schema.barcodeAltText !== undefined ? interpolate(schema.barcodeAltText).slice(0, 128) : `BIB #${resolve('bib')}`.slice(0, 128),
    logoText: interpolate(schema.logoText ?? raceName ?? 'Athletic Pass').slice(0, 64),
    description: interpolate(schema.description ?? `${raceName} Participant Pass`).slice(0, 128),
    organizationName: interpolate(schema.organizationName ?? orgName ?? '3F Striders').slice(0, 64),
    sharingProhibited: schema.sharingProhibited ?? false,
    colorPreset: getWalletColorPreset(schema.colorPreset || template?.background_color).id,
    headerFields: fields('headerFields'), primaryFields: fields('primaryFields'),
    secondaryFields: fields('secondaryFields'), backFields: fields('backFields'),
  };
  // Choosing a preset must not also send a preview hex as `color`: that overrides the preset.
  // Custom color is opt-in, separately stored as schema.color, and requires a paid plan.
  if (schema.color !== undefined) {
    if (plan !== 'pro') throw new Error('Custom color requires WalletWallet Pro; select a colorPreset on Free');
    body.color = schema.color;
  }
  for (const [wire, column] of [['logoURL', 'logo_image_url'], ['stripURL', 'strip_image_url'], ['backgroundURL', 'background_image_url']] as const) {
    const image = (template as any)?.[column];
    if (!image) continue;
    if (plan !== 'pro') throw new Error(`${wire} requires WalletWallet Pro`);
    if (!/^https:\/\//i.test(image) && !/^data:image\/png;base64,/i.test(image)) throw new Error(`${wire} must be HTTPS or a PNG data URI`);
    body[wire] = image;
  }
  return body;
}
