export const MAX_EMAIL_LOGO_BYTES = 256 * 1024;
export const EMAIL_FONTS = {
  arial: 'Arial,Helvetica,sans-serif',
  verdana: 'Verdana,Geneva,sans-serif',
  georgia: 'Georgia,Times,serif',
} as const;
export interface EmailDesign {
  backgroundColor: string; cardColor: string; textColor: string;
  headerColor: string; headerTextColor: string;
  buttonColor: string; buttonTextColor: string; linkColor: string;
  fontFamily: keyof typeof EMAIL_FONTS; fontSize: number; corners: 'rounded' | 'square';
  signatureText: string; signatureAlign: 'left' | 'center';
  logo: string; logoAlt: string; logoWidth: number;
}
export const DEFAULT_EMAIL_DESIGN: EmailDesign = {
  backgroundColor: '#0f172a', cardColor: '#1e293b', textColor: '#e2e8f0',
  headerColor: '#0369a1', headerTextColor: '#ffffff',
  buttonColor: '#38bdf8', buttonTextColor: '#0f172a', linkColor: '#38bdf8',
  fontFamily: 'arial', fontSize: 15, corners: 'rounded',
  signatureText: '', signatureAlign: 'left', logo: '', logoAlt: '3F Striders logo', logoWidth: 160,
};
export const EMAIL_COLOR_LABELS = {
  backgroundColor: 'Page background', cardColor: 'Message background', textColor: 'Message text',
  headerColor: 'Header background', headerTextColor: 'Header text',
  buttonColor: 'Button background', buttonTextColor: 'Button text', linkColor: 'Fallback link',
} as const;
export const EMAIL_THEMES = {
  '3F Dark': DEFAULT_EMAIL_DESIGN,
  'Clean Light': { ...DEFAULT_EMAIL_DESIGN, backgroundColor: '#f1f5f9', cardColor: '#ffffff',
    textColor: '#334155', headerColor: '#0369a1', buttonColor: '#0369a1', buttonTextColor: '#ffffff', linkColor: '#0369a1' },
  'Purple': { ...DEFAULT_EMAIL_DESIGN, backgroundColor: '#faf5ff', cardColor: '#ffffff',
    textColor: '#3b0764', headerColor: '#6b21a8', buttonColor: '#6b21a8', buttonTextColor: '#ffffff', linkColor: '#6b21a8' },
} satisfies Record<string, EmailDesign>;

export function contrastRatio(a: string, b: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Uploaded logos are embedded as CID attachments, never published on the pass hostname.
export function emailLogoAttachment(logo: string) {
  const match = logo.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) throw new Error('Logo must be an HTTPS URL or a PNG/JPEG file');
  const bytes = atob(match[2]);
  if (bytes.length > MAX_EMAIL_LOGO_BYTES) throw new Error('Signature logo must be 256 KB or smaller');
  if (btoa(bytes) !== match[2]) throw new Error('Invalid logo encoding');
  const magic = match[1] === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (!magic.every((value, index) => bytes.charCodeAt(index) === value)) throw new Error('Logo contents do not match its PNG/JPEG format');
  return { filename: `signature-logo.${match[1] === 'png' ? 'png' : 'jpg'}`, content: match[2],
    content_type: `image/${match[1]}`, content_id: 'email-signature-logo' };
}

export function validateEmailDesign(input?: unknown): EmailDesign {
  if (input === undefined || input === null) return { ...DEFAULT_EMAIL_DESIGN };
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Email design must be an object');
  const value = input as Record<string, unknown>, result = { ...DEFAULT_EMAIL_DESIGN };
  for (const key of Object.keys(EMAIL_COLOR_LABELS) as (keyof typeof EMAIL_COLOR_LABELS)[]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value[key])) throw new Error(`${EMAIL_COLOR_LABELS[key]} must be a six-digit hex color`);
      result[key] = value[key].toLowerCase();
    }
  }
  for (const [key, allowed] of [['fontFamily', Object.keys(EMAIL_FONTS)], ['corners', ['rounded', 'square']], ['signatureAlign', ['left', 'center']]] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || !allowed.includes(value[key] as never)) throw new Error(`Select a valid ${key}`);
      (result as any)[key] = value[key];
    }
  }
  for (const [key, min, max] of [['fontSize', 14, 20], ['logoWidth', 40, 320]] as const) {
    if (value[key] !== undefined) {
      if (!Number.isInteger(value[key]) || Number(value[key]) < min || Number(value[key]) > max) throw new Error(`${key} must be between ${min} and ${max}`);
      result[key] = Number(value[key]);
    }
  }
  for (const [key, max] of [['signatureText', 2000], ['logoAlt', 100], ['logo', 360_000]] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > max) throw new Error(`${key} must be ${max} characters or fewer`);
      result[key] = value[key].trim();
    }
  }
  if (result.logo.startsWith('data:')) emailLogoAttachment(result.logo);
  else if (result.logo) {
    let url: URL;
    try { url = new URL(result.logo); } catch { throw new Error('Logo URL must be a complete HTTPS image URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || result.logo.length > 2048) throw new Error('Logo URL must be an HTTPS image URL without credentials');
    result.logo = url.href;
  }
  for (const [fg, bg, label] of [
    ['buttonTextColor', 'buttonColor', 'Button'], ['textColor', 'cardColor', 'Message'],
    ['headerTextColor', 'headerColor', 'Header'], ['linkColor', 'cardColor', 'Fallback link'],
  ] as const) {
    if (contrastRatio(result[fg], result[bg]) < 4.5) throw new Error(`${label} colors need more contrast. Choose a lighter text color or a darker background (minimum 4.5:1).`);
  }
  return result;
}

export function parseEmailDesignJson(json?: string | null): EmailDesign {
  return validateEmailDesign(json ? JSON.parse(json) : undefined);
}
