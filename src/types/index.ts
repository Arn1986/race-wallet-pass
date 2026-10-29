export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  valueTemplate?: string; // e.g. "{{bib}}" or "{{category}}"
  alignment?: 'left' | 'center' | 'right';
  changeMessage?: string; // e.g. "Bib assigned: %@ %@"
}

export type WalletColorPreset = 'dark' | 'blue' | 'green' | 'red' | 'purple' | 'orange';

export interface WalletColorPresetConfig {
  id: WalletColorPreset;
  name: string;
  bgHex: string;
  textHex: string;
  labelHex: string;
  borderHex: string;
  badgeClass: string;
  description: string;
}

export const WALLET_COLOR_PRESETS: Record<WalletColorPreset, WalletColorPresetConfig> = {
  dark: {
    id: 'dark',
    name: 'Dark (Default)',
    bgHex: '#18181b',
    textHex: '#ffffff',
    labelHex: '#a1a1aa',
    borderHex: '#3f3f46',
    badgeClass: 'bg-zinc-800 text-zinc-200 border-zinc-700',
    description: 'Contrast-safe rich dark theme',
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    bgHex: '#1e3a8a',
    textHex: '#ffffff',
    labelHex: '#93c5fd',
    borderHex: '#2563eb',
    badgeClass: 'bg-blue-900/80 text-blue-200 border-blue-700',
    description: 'Royal athletic blue theme',
  },
  green: {
    id: 'green',
    name: 'Green',
    bgHex: '#064e3b',
    textHex: '#ffffff',
    labelHex: '#6ee7b7',
    borderHex: '#059669',
    badgeClass: 'bg-emerald-900/80 text-emerald-200 border-emerald-700',
    description: 'Emerald trail & endurance green',
  },
  red: {
    id: 'red',
    name: 'Red',
    bgHex: '#881337',
    textHex: '#ffffff',
    labelHex: '#fda4af',
    borderHex: '#e11d48',
    badgeClass: 'bg-rose-900/80 text-rose-200 border-rose-700',
    description: 'High-energy crimson race red',
  },
  purple: {
    id: 'purple',
    name: 'Purple',
    bgHex: '#581c87',
    textHex: '#ffffff',
    labelHex: '#d8b4fe',
    borderHex: '#9333ea',
    badgeClass: 'bg-purple-900/80 text-purple-200 border-purple-700',
    description: 'Deep royal violet theme',
  },
  orange: {
    id: 'orange',
    name: 'Orange',
    bgHex: '#7c2d12',
    textHex: '#ffffff',
    labelHex: '#fdba74',
    borderHex: '#ea580c',
    badgeClass: 'bg-orange-900/80 text-orange-200 border-orange-700',
    description: 'Energetic amber orange theme',
  },
};

export function getWalletColorPreset(presetOrHex?: string): WalletColorPresetConfig {
  if (!presetOrHex) return WALLET_COLOR_PRESETS.dark;
  const normalized = presetOrHex.toLowerCase().trim();
  if (Object.hasOwn(WALLET_COLOR_PRESETS, normalized)) return WALLET_COLOR_PRESETS[normalized as WalletColorPreset];
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) return WALLET_COLOR_PRESETS.dark;
  const expanded = normalized.length === 4 ? '#' + normalized.slice(1).split('').map(c => c + c).join('') : normalized;
  const exact = Object.values(WALLET_COLOR_PRESETS).find(p => p.bgHex.toLowerCase() === expanded);
  if (exact) return exact;
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const target = rgb(expanded);
  return Object.values(WALLET_COLOR_PRESETS).reduce((best, preset) => {
    const distance = (p: WalletColorPresetConfig) => rgb(p.bgHex).reduce((sum, n, i) => sum + (n - target[i]) ** 2, 0);
    return distance(preset) < distance(best) ? preset : best;
  }, WALLET_COLOR_PRESETS.dark);
}

export interface WalletWalletField {
  label: string;
  value?: string;
  key?: string;
  changeMessage?: string;
}

export interface PassSchema {
  logoURL?: string;
  iconURL?: string;
  thumbnailURL?: string;
  backgroundURL?: string;
  organizationName?: string;
  logoText?: string;
  description?: string;
  colorPreset?: WalletColorPreset;
  barcodeFormat?: 'QR' | 'Code128' | 'PDF417' | 'Aztec';
  barcodeType?: string; // backwards compatibility
  barcodeAltText?: string;
  headerFields?: WalletWalletField[];
  primaryFields?: WalletWalletField[];
  secondaryFields?: WalletWalletField[];
  auxiliaryFields?: WalletWalletField[]; // legacy compatibility
  backFields?: WalletWalletField[];
  sharingProhibited?: boolean;
  passType?: 'eventTicket' | 'generic' | 'boardingPass';
}

export interface PassTemplate {
  id: string;
  org_id: string;
  name: string;
  background_color: string;
  text_color: string;
  label_color: string;
  logo_image_url: string;
  background_image_url?: string;
  strip_image_url: string;
  schema_definition: string; // JSON string of PassSchema
  created_at: string;
}

export interface Race {
  allow_duplicate_emails?: boolean | number;
  email_template_id?: string | null;
  email_template_name?: string | null;
  id: string;
  org_id: string;
  template_id: string;
  name: string;
  event_date: string;
  location: string;
  field_mapping: string; // JSON mapping CSV columns -> Template fields
  created_at: string;
  // Join fields
  template_name?: string;
  runner_count?: number;
  issued_count?: number;
}

export interface Runner {
  id: string;
  race_id: string;
  email: string;
  first_name: string;
  last_name: string;
  dynamic_data: string; // JSON string of Record<string, any>
  created_at: string;
  // Join fields
  pass?: Pass;
  race_name?: string;
}

export interface Pass {
  id: string;
  runner_id: string;
  walletwallet_pass_id: string;
  google_save_url?: string;
  share_url?: string;
  apple_pass_base64?: string;
  status: 'pending' | 'issued' | 'revoked' | 'failed';
  installed_apple: number; // 0 or 1
  installed_google: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface QueueJob {
  id: string;
  runner_id: string;
  race_id: string;
  payload: {
    first_name: string;
    last_name: string;
    email: string;
    dynamic_data: Record<string, any>;
  };
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  created_at: string;
  processed_at?: string;
}

export interface PushNotificationLog {
  id: string;
  runner_id: string;
  pass_id: string;
  runner_name: string;
  field_changed: string;
  old_value: string;
  new_value: string;
  timestamp: string;
  status: 'dispatched' | 'delivered';
}

export interface ResendEmailLog {
  id: string;
  runner_id: string;
  to: string;
  subject: string;
  pass_url: string;
  sent_at: string;
  status: 'delivered' | 'bounced' | 'queued';
}

export interface R2Asset {
  key: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  uploaded_at: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
