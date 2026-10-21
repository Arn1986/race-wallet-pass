export const ARTWORK_FIELDS = ['logoURL', 'iconURL', 'thumbnailURL', 'backgroundURL'] as const;
export type ArtworkField = typeof ARTWORK_FIELDS[number];
export type TemplateArtwork = Record<ArtworkField, string>;
export const EMPTY_ARTWORK: TemplateArtwork = { logoURL: '', iconURL: '', thumbnailURL: '', backgroundURL: '' };
export const MAX_IMAGE_BYTES = 1_000_000;
export const MAX_TEMPLATE_BYTES = 1_800_000;

export function normalizeArtwork(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${field} must be a URL or PNG image`);
  const image = value.trim();
  if (!image) return '';
  if (image.startsWith('data:')) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error(`${field} must be a PNG data URI`);
    let bytes: string;
    try { bytes = atob(image.slice('data:image/png;base64,'.length)); } catch { throw new Error(`${field} contains invalid image data`); }
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${field} exceeds the 1 MB image limit`);
    if (!bytes.startsWith('\x89PNG\r\n\x1a\n')) throw new Error(`${field} is not a PNG image`);
    return image;
  }
  try {
    const url = new URL(image);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error(`${field} must use a public HTTPS URL or a PNG file`); }
}

export function getTemplateArtwork(template?: { schema_definition?: string; logo_image_url?: string; background_image_url?: string }): TemplateArtwork {
  let schema: any = {};
  try { schema = JSON.parse(template?.schema_definition || '{}') || {}; } catch {}
  const fallback: Record<string, string> = { logoURL: template?.logo_image_url || '', backgroundURL: template?.background_image_url || '' };
  return Object.fromEntries(ARTWORK_FIELDS.map(field => [field,
    Object.hasOwn(schema, field) ? (typeof schema[field] === 'string' ? schema[field] : '') : fallback[field] || '',
  ])) as TemplateArtwork;
}
