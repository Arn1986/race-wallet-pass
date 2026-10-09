import JSZip from 'jszip';
import crypto from 'crypto';
import { Runner, Race, PassTemplate, Pass } from '../src/types/index.ts';

// 1x1 transparent PNG buffer for icon.png and logo.png
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Convert hex color (e.g. #0f172a) to Apple Wallet 'rgb(15, 23, 42)' format
export function hexToRgb(hex: string): string {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((c) => c + c).join('');
  }
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return `rgb(${r}, ${g}, ${b})`;
}

export async function generatePkpassBundle(options: {
  runner: Runner;
  race: Race;
  template: PassTemplate;
  pass: Pass;
}): Promise<Buffer> {
  const { runner, race, template, pass } = options;

  let dynamic: Record<string, any> = {};
  try {
    dynamic = JSON.parse(runner.dynamic_data || '{}');
  } catch {
    dynamic = {};
  }

  let schemaDef: any = {};
  try {
    schemaDef = JSON.parse(template.schema_definition || '{}');
  } catch {
    schemaDef = {};
  }

  // Map values according to race's field_mapping
  let mapping: Record<string, string> = {};
  try {
    mapping = JSON.parse(race.field_mapping || '{}');
  } catch {
    mapping = {};
  }

  const resolveFieldValue = (fieldKey: string, fallback: string = '') => {
    // If fieldKey is mapped to a column in dynamic_data
    const targetKey = mapping[fieldKey] || fieldKey;
    if (dynamic[targetKey] !== undefined) return String(dynamic[targetKey]);
    if (dynamic[fieldKey] !== undefined) return String(dynamic[fieldKey]);
    if (fieldKey === 'bib') return dynamic.bib_number || dynamic.bib || '999';
    if (fieldKey === 'category') return dynamic.race_division || dynamic.category || '42K';
    if (fieldKey === 'wave') return dynamic.start_wave || dynamic.wave || 'Wave A';
    return fallback;
  };

  const primaryFields = (schemaDef.primaryFields || [
    { key: 'bib', label: 'BIB NUMBER' }
  ]).map((f: any) => ({
    key: f.key,
    label: f.label,
    value: resolveFieldValue(f.key, '1042'),
    textAlignment: f.alignment === 'center' ? 'PKTextAlignmentCenter' : f.alignment === 'right' ? 'PKTextAlignmentRight' : 'PKTextAlignmentLeft',
    changeMessage: f.changeMessage || 'Bib Number changed to: %@'
  }));

  const secondaryFields = (schemaDef.secondaryFields || [
    { key: 'category', label: 'CATEGORY' },
    { key: 'wave', label: 'START WAVE' }
  ]).map((f: any) => ({
    key: f.key,
    label: f.label,
    value: resolveFieldValue(f.key, 'Full Marathon'),
    textAlignment: f.alignment === 'right' ? 'PKTextAlignmentRight' : 'PKTextAlignmentLeft',
    changeMessage: f.changeMessage || 'Field updated to: %@'
  }));

  const auxiliaryFields = (schemaDef.auxiliaryFields || [
    { key: 'corral', label: 'CORRAL' },
    { key: 'runner_name', label: 'ATHLETE' }
  ]).map((f: any) => {
    if (f.key === 'runner_name') {
      return {
        key: 'runner_name',
        label: 'ATHLETE',
        value: `${runner.first_name} ${runner.last_name}`,
      };
    }
    return {
      key: f.key,
      label: f.label,
      value: resolveFieldValue(f.key, 'Open'),
      textAlignment: f.alignment === 'right' ? 'PKTextAlignmentRight' : 'PKTextAlignmentLeft',
    };
  });

  const backFields = (schemaDef.backFields || [
    { key: 'emergency_contact', label: 'Emergency Contact' },
    { key: 'medical_notes', label: 'Medical Information' },
    { key: 'race_rules', label: 'Rules & Regulations' }
  ]).map((f: any) => ({
    key: f.key,
    label: f.label,
    value: resolveFieldValue(f.key, 'In case of emergency please contact race medical team.'),
  }));

  const passJson: Record<string, any> = {
    formatVersion: 1,
    passTypeIdentifier: 'pass.com.walletpass.platform',
    serialNumber: pass.walletwallet_pass_id || pass.id,
    teamIdentifier: 'PACIFICATH',
    webServiceURL: 'https://walletpass.cloud/api/v1/passes',
    authenticationToken: crypto.randomBytes(16).toString('hex'),
    organizationName: 'Pacific Athletic Club',
    description: `${race.name} - Participant Pass`,
    foregroundColor: hexToRgb(template.text_color || '#ffffff'),
    backgroundColor: hexToRgb(template.background_color || '#0f172a'),
    labelColor: hexToRgb(template.label_color || '#38bdf8'),
    logoText: race.name.length > 28 ? race.name.substring(0, 25) + '...' : race.name,
    eventTicket: {
      primaryFields,
      secondaryFields,
      auxiliaryFields,
      backFields,
    },
    barcode: {
      message: `WALLET-PASS:${pass.id}:${runner.id}:${dynamic.bib_number || '1042'}`,
      format: schemaDef.barcodeType || 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText: schemaDef.barcodeAltText || `BIB #${resolveFieldValue('bib', '1042')} - ${runner.first_name} ${runner.last_name}`,
    },
    barcodes: [
      {
        message: `WALLET-PASS:${pass.id}:${runner.id}:${dynamic.bib_number || '1042'}`,
        format: schemaDef.barcodeType || 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
        altText: schemaDef.barcodeAltText || `BIB #${resolveFieldValue('bib', '1042')} - ${runner.first_name} ${runner.last_name}`,
      }
    ],
  };

  const passJsonStr = JSON.stringify(passJson, null, 2);
  const iconBuffer = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

  // Compute SHA1 manifest
  const manifest: Record<string, string> = {
    'pass.json': crypto.createHash('sha1').update(passJsonStr).digest('hex'),
    'icon.png': crypto.createHash('sha1').update(iconBuffer).digest('hex'),
    'icon@2x.png': crypto.createHash('sha1').update(iconBuffer).digest('hex'),
    'logo.png': crypto.createHash('sha1').update(iconBuffer).digest('hex'),
  };

  const manifestStr = JSON.stringify(manifest, null, 2);

  // Mock Apple signature block for complete bundle specification
  const mockSignature = crypto.createHash('sha256').update(manifestStr).digest();

  // Create ZIP archive
  const zip = new JSZip();
  zip.file('pass.json', passJsonStr);
  zip.file('manifest.json', manifestStr);
  zip.file('icon.png', iconBuffer);
  zip.file('icon@2x.png', iconBuffer);
  zip.file('logo.png', iconBuffer);
  zip.file('signature', mockSignature);

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function proxyOrGeneratePkpass(options: {
  runner: Runner;
  race: Race;
  template: PassTemplate;
  pass: Pass;
  walletwalletApiKey?: string;
  walletwalletApiUrl?: string;
}): Promise<Buffer> {
  const { runner, pass, walletwalletApiKey, walletwalletApiUrl } = options;

  // Try real walletwallet.dev API if key provided and url valid
  if (walletwalletApiKey && walletwalletApiKey.startsWith('ww_live') && pass.walletwallet_pass_id) {
    try {
      const url = `${walletwalletApiUrl || 'https://api.walletwallet.dev/v1'}/passes/${pass.walletwallet_pass_id}/pkpass`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${walletwalletApiKey}`,
          Accept: 'application/vnd.apple.pkpass',
        },
      });
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch {
      // Fallback gracefully to generating the binary package locally
    }
  }

  // Local edge generation
  return await generatePkpassBundle(options);
}
